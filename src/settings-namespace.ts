/**
 * Host half of the plugin's durable settings namespace
 * (`dsh-auto-review-jev`), which the browser settings page binds through
 * `ctx.configForms`.
 *
 * Why this exists: the settings page's fields are writable ONLY when the
 * namespace is registered by a Host plugin — an unregistered namespace makes
 * the client scope report `unavailable` and every control disable. The
 * registration also makes the values durable (they persist in the Host's
 * settings document) and live (a committed change updates the running
 * reviewer through {@link JevLiveSettings}).
 *
 * The API KEY is deliberately NOT here: it is a credential, so it lives in
 * the credentials domain under `TYPESAFE_API_KEY`. Only non-secret,
 * user-tunable scalars belong in this namespace.
 *
 * @module @dsh-external/dsh-auto-review-jev/settings-namespace
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS } from './client.ts'
import { endpointProblem } from './endpoint.ts'
import { JEV_SETTINGS_NS } from './wire-shared.ts'

// Re-exported so the package root keeps exposing the namespace constant.
export { JEV_SETTINGS_NS }

/**
 * The non-secret fields a user may edit from the settings page. Mirrors the
 * client page's text fields; the credential and the review thresholds stay
 * out (thresholds are deployment policy, not user preference).
 */
export interface JevEditableSettings {
  endpoint: string
  usageEndpoint: string
  model: string
  timeoutMs: number
  usageRefreshSeconds: number
}

export const JevEditableSchema: z<JevEditableSettings> = z.object({
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  usageEndpoint: z.string().default(''),
  model: z.string().default(DEFAULT_MODEL),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  usageRefreshSeconds: z.number().default(300),
})

/**
 * The live settings holder the reviewer reads on every call.
 *
 * A settings commit must reach an already-running reviewer without a restart,
 * so every hot-path read goes through this holder rather than a capture of
 * the boot-time config. The holder is the single place that resolves the
 * precedence: durable user layer (via the registration watch) over the
 * composition base, with the plugin's own cordis config as the initial value.
 */
export class JevLiveSettings {
  private current: JevEditableSettings

  constructor(initial: JevEditableSettings) {
    this.current = { ...initial }
  }

  /** The current effective values. */
  read(): JevEditableSettings {
    return this.current
  }

  /** Adopt a committed namespace value (called by the registration watch). */
  apply(next: JevEditableSettings): void {
    this.current = { ...next }
  }
}

/** The shape of the registered owner scope this module consumes. */
interface SettingsOwnerScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
}

/** The `settings` service face this module needs, declared structurally. */
interface SettingsRegistry {
  register<T>(
    ns: string,
    schema: z<T>,
    options?: {
      base?: Partial<T>
      applies?: 'live' | 'restart'
      validate?: (value: T) => void
    },
  ): SettingsOwnerScope<T>
}

/**
 * Refuse a section the reviewer could not act on: both endpoints must be
 * absolute URLs (or empty), and the knobs must be in range. Thrown here, the
 * refusal rejects the WRITE, so the settings page reports it instead of
 * storing a value that would silently break every review call.
 */
function validateSettings(value: JevEditableSettings): void {
  for (const [field, raw] of [['endpoint', value.endpoint], ['usageEndpoint', value.usageEndpoint]] as const) {
    // Empty re-inherits the deployment's base value, so it is not this rule's
    // business; what matters is the destination a key would be sent to.
    if (raw.trim() === '') continue
    const problem = endpointProblem(field, raw)
    if (problem !== undefined) throw new Error(problem)
  }
  if (!Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive number')
  }
  if (!Number.isFinite(value.usageRefreshSeconds) || value.usageRefreshSeconds < 30) {
    throw new Error('usageRefreshSeconds must be at least 30')
  }
}

/**
 * Register the durable namespace and route its committed values into `live`.
 *
 * Rides the optional `settings` service: a profile without a settings
 * provider (headless, TUI) keeps the boot-time config and simply has no
 * durable section — never a hard dependency, so the plugin still loads.
 *
 * @param ctx - plugin context.
 * @param initial - the composition-layer values (the plugin's own config).
 * @param live - holder the reviewer reads.
 */
export function applySettingsNamespace(
  ctx: Context,
  initial: JevEditableSettings,
  live: JevLiveSettings,
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = (settingsCtx as unknown as { settings: SettingsRegistry }).settings
    const scope = settings.register(JEV_SETTINGS_NS, JevEditableSchema, {
      // The cordis config entry is the composition layer: clearing a field in
      // the UI re-inherits exactly what the deployment declared.
      base: initial,
      applies: 'live',
      validate: validateSettings,
    })
    // Seed from the resolved value (user layer over base), then track commits.
    live.apply(scope.get())
    settingsCtx.effect(() => scope.watch((next) => {
      live.apply(next)
    }), '@dsh-external/dsh-auto-review-jev: settings namespace')
  })
}
