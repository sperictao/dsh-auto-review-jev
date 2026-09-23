/**
 * Browser controller for the "Auto Review Jev" settings page.
 *
 * The page lives at the same settings-nav level as General / Models /
 * Plugins (a `settings.section` entry, id `jev-auto-review`). It owns the
 * connection facts the plugin resolves per review:
 *
 *   - API key      -> written through the credentials domain under the
 *                     `TYPESAFE_API_KEY` reference (the env var the Host
 *                     resolves first). The literal never rides a response,
 *                     so the control only reports whether one is configured.
 *   - endpoint / usageEndpoint / model -> the plugin's own settings
 *                     namespace (`dsh-auto-review-jev`), read by the Host's
 *                     Config schema.
 *
 * The controller binds the namespace through the `configForms` service,
 * keeps a staged draft of edits, and writes them on save through
 * `form.set` / the credentials domain. The Host stays the single fact
 * source; the snapshot is republished after each accepted write.
 *
 * This module is deliberately free of JSX — it only produces the state face
 * the React component renders.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/settings
 */

import { endpointProblem } from '../endpoint.ts'
import { API_KEY_REF } from '../wire-shared.ts'

/** The config-form snapshot fields consumed by this controller. */
export interface ConfigFormSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/**
 * Current config-form service face used without importing a browser plugin
 * value.
 *
 * `set` / `unset` answer the Host's acceptance: a write the namespace's own
 * validation refused resolves `false` instead of storing, so a caller that
 * ignores the boolean would report success for a value that never landed.
 */
export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

/** Result envelope returned by one current Typert Remote call. */
interface RemoteResult<T> {
  ok: boolean
  value?: T
  error?: { message: string }
}

/** Credential facts returned without exposing the credential value. */
interface CredentialInfo {
  configured: boolean
  writable: boolean
}

/** The narrow slice of the wire face this controller needs. */
export interface SettingsPageApi {
  credentials: {
    describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
    set(ref: string, value: string): Promise<RemoteResult<void>>
    unset(ref: string): Promise<RemoteResult<void>>
  }
}

/** One staged text field. */
export interface StagedField {
  /** Live draft text the input shows. */
  text: string
  /** Whether the user explicitly cleared the field (reset to inherited). */
  clear: boolean
  /** Whether the user layer carries this field (marks it overridden). */
  overridden: boolean
  /** Whether the staged draft fails validation (blocks save). */
  invalid: boolean
}

/** The page's state face. */
export interface SettingsPageState {
  /** Whether the namespace snapshot is ready. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the API key is currently configured (Host-reported). */
  apiKeyConfigured: boolean
  /** Whether the credentials domain can store the key. */
  apiKeyWritable: boolean
  /** The API key draft (write-only; starts blank, never echoes the stored key). */
  apiKey: StagedField
  /** Whether the stored key is staged for removal on the next save. */
  apiKeyClearStaged: boolean
  /** Evaluation endpoint draft. */
  endpoint: StagedField
  /** Account-usage endpoint draft ('' disables account polling). */
  usageEndpoint: StagedField
  /** Model id draft. */
  model: StagedField
  /** True while a save is in flight. */
  saving: boolean
  /** True when the last save failed (the page renders a retry affordance). */
  failed: boolean
  /** Whether ANY field carries an unsaved edit (drives the footer buttons). */
  dirty: boolean
}

const BLANK: StagedField = { text: '', clear: false, overridden: false, invalid: false }

const TEXT_FIELDS = ['endpoint', 'usageEndpoint', 'model'] as const
type TextField = typeof TEXT_FIELDS[number]

/**
 * Controller bridging the settings form and the credentials domain onto the
 * page. Public API mirrors the harness's settings-card actions, so the
 * component stays thin.
 */
export class JevSettingsController {
  private readonly form: ConfigForm<Record<string, unknown>>
  private readonly api: SettingsPageApi
  private readonly drafts = new Map<TextField, string>()
  private readonly listeners = new Set<() => void>()
  private readonly disposers: Array<() => void> = []
  private disposed = false
  private keyDraft = ''
  private keyClearStaged = false
  private keyConfigured = false
  private keyWritable = false
  private saving = false
  private failed = false

  constructor(form: ConfigForm<Record<string, unknown>>, api: SettingsPageApi) {
    this.form = form
    this.api = api
    this.disposers.push(form.subscribe(() => {
      void this.describeKey()
      this.publish()
    }))
    void this.describeKey()
  }

  /** Release every subscription held on external sources. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
    this.listeners.clear()
  }

  /** Subscribe to state projections. @returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Refresh the credential's configured/writable facts from the Host. */
  private async describeKey(): Promise<void> {
    if (this.disposed) return
    try {
      const result = await this.api.credentials.describe([API_KEY_REF])
      if (this.disposed) return
      const info = result.ok ? result.value?.[API_KEY_REF] : undefined
      this.keyConfigured = info?.configured ?? false
      this.keyWritable = info?.writable ?? false
    } catch {
      if (!this.disposed) {
        this.keyConfigured = false
        this.keyWritable = false
      }
    }
    this.publish()
  }

  private stored(field: TextField): string {
    const value = this.form.getSnapshot().value?.[field]
    return typeof value === 'string' ? value : ''
  }

  private userHas(field: TextField): boolean {
    const user = this.form.getSnapshot().user
    return user !== null && typeof user === 'object' && !Array.isArray(user)
      && typeof (user as Record<string, unknown>)[field] === 'string'
  }

  private fieldState(field: TextField): StagedField {
    const draft = this.drafts.get(field)
    const text = draft ?? this.stored(field)
    return {
      text,
      clear: draft !== undefined && draft.trim() === '' && this.stored(field) !== '',
      overridden: this.userHas(field),
      invalid: field === 'model' ? false : endpointProblem(field, text) !== undefined,
    }
  }

  /** Build the current page state face. */
  state(): SettingsPageState {
    const snapshot = this.form.getSnapshot()
    const fields = TEXT_FIELDS.map((field) => this.fieldState(field))
    const dirty = this.drafts.size > 0 || this.keyDraft !== '' || this.keyClearStaged
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      apiKeyConfigured: this.keyConfigured,
      apiKeyWritable: this.keyWritable,
      apiKey: { ...BLANK, text: this.keyDraft },
      apiKeyClearStaged: this.keyClearStaged,
      endpoint: this.fieldState('endpoint'),
      usageEndpoint: this.fieldState('usageEndpoint'),
      model: this.fieldState('model'),
      saving: this.saving,
      failed: this.failed,
      dirty: dirty && fields.every((field) => !field.invalid),
    }
  }

  /** Stage one text field's draft. */
  edit(field: TextField | 'apiKey', text: string): void {
    if (this.disposed) return
    if (field === 'apiKey') {
      this.keyDraft = text
      if (text !== '') this.keyClearStaged = false
    } else {
      if (text === this.stored(field)) this.drafts.delete(field)
      else this.drafts.set(field, text)
    }
    this.publish()
  }

  /** Reset one field to the stored value (drops the draft). */
  resetField(field: TextField | 'apiKey'): void {
    if (this.disposed) return
    if (field === 'apiKey') {
      this.keyDraft = ''
      this.keyClearStaged = false
    } else {
      this.drafts.delete(field)
    }
    this.publish()
  }

  /** Stage removal of the stored key on the next save. */
  stageKeyClear(): void {
    if (this.disposed) return
    this.keyClearStaged = true
    this.keyDraft = ''
    this.publish()
  }

  /** Drop every staged edit. */
  discard(): void {
    if (this.disposed) return
    this.drafts.clear()
    this.keyDraft = ''
    this.keyClearStaged = false
    this.failed = false
    this.publish()
  }

  /**
   * Write every staged field, then the credential. The key write runs last
   * so a failed text save never strands a new key on old endpoints.
   *
   * A write the Host refused (`false`, e.g. the namespace's own validation
   * rejecting an endpoint that is not an absolute URL) fails the save, which
   * is what puts the page's error banner up instead of reporting success for
   * a value that never landed.
   */
  async save(): Promise<void> {
    if (this.disposed || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      for (const [field, text] of this.drafts) {
        const next = text.trim()
        if (next === this.stored(field)) continue
        const accepted = next === ''
          ? await this.form.unset(field)
          : await this.form.set(field, next)
        if (!accepted) throw new Error(`${field} was refused by the settings host`)
      }
      if (this.keyClearStaged) {
        const result = await this.api.credentials.unset(API_KEY_REF)
        if (!result.ok) throw new Error(result.error?.message ?? 'credential unset failed')
      } else if (this.keyDraft.trim() !== '') {
        const result = await this.api.credentials.set(API_KEY_REF, this.keyDraft.trim())
        if (!result.ok) throw new Error(result.error?.message ?? 'credential set failed')
      }
      this.drafts.clear()
      this.keyDraft = ''
      this.keyClearStaged = false
      await this.describeKey()
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      if (!this.disposed) this.publish()
    }
  }

  private publish(): void {
    if (this.disposed) return
    for (const listener of this.listeners) listener()
  }
}
