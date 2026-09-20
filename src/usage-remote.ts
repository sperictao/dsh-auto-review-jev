/**
 * Host half of the `jev/report` Remote: the Cordis service the Typert Gateway
 * resolves for the browser sidebar card, plus the local usage accumulator and
 * the background account-usage poll.
 *
 * Two Cordis service keys are involved:
 *
 * - `jevUsageConfig` — a plain value object the plugin entry provides,
 *   exposing the live config getters (key/endpoint/model). Kept separate so
 *   this service can be constructed without the reviewer's closure.
 * - `jevUsage` — this service. The Gateway binds it to the wire namespace
 *   `jev` through the `TypertRemoteService` base, which stamps the
 *   `typertRemote` binding validated on every dispatch.
 *
 * The browser bundle never holds the API key — it reads everything through
 * this Remote, exactly like the reference provider's `usage-remote.ts`.
 *
 * @module @dsh-external/dsh-auto-review-jev/usage-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { fetchAccountUsage, JevError } from './client.ts'
import type { JevAccountUsage, JevLocalUsage, JevUsageReport } from './usage-wire.ts'
import { USAGE_HOST_CONTRIBUTION } from './usage-wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    jevUsage: JevUsageService
    jevUsageConfig: JevUsageConfigSource
  }
}

/** What the service needs to know about the plugin's live configuration. */
export interface JevUsageConfigSource {
  /** Effective API key, resolved per call (credential store over config). */
  apiKey(): Promise<string | undefined>
  endpoint(): string
  usageEndpoint(): string
  model(): string
  timeoutMs(): number
}

/** The Typert registry face the Host contribution registers against. */
interface TypertContributionRegistry {
  register(contribution: {
    package: string
    face: 'host'
    schemas: unknown[]
    model: { services: unknown[]; events: unknown[]; objects: unknown[] }
    invocations: unknown[]
  }): () => void | Promise<void>
}

const EMPTY_LOCAL: JevLocalUsage = {
  calls: 0,
  allowed: 0,
  denied: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  since: 0,
  lastCallAt: 0,
}

/**
 * The usage service and Remote receiver. Owns the local counters (fed by the
 * reviewer through {@link recordCall}) and the cached account-side snapshot
 * (refreshed by {@link refreshAccount}, on a timer and on demand). All state
 * is in-memory: counters reset on Host restart, which the UI states
 * explicitly.
 */
export class JevUsageService extends TypertRemoteService {
  /**
   * The Service base auto-registers `jevUsage` on construction and cordis
   * collects `jevUsageConfig` into the child fiber's own context from this
   * declaration — `ctx.provide('jevUsage')` must NOT be called by hand (that
   * double-registration is exactly the boot failure `service "jevUsage" has
   * been registered`).
   */
  static inject = ['jevUsageConfig']

  private readonly config: JevUsageConfigSource
  private local: JevLocalUsage = { ...EMPTY_LOCAL }
  private account: JevAccountUsage | null = null
  private accountError = ''
  private accountFetchedAt = 0
  private inFlight: Promise<void> | undefined

  constructor(ctx: Context) {
    super(ctx, 'jevUsage', { namespace: 'jev' })
    this.config = ctx.jevUsageConfig
  }

  /**
   * Record one finished reviewer call. `usage` is the token counter from the
   * SystemOne response; `outcome` is the decision the reviewer derived.
   */
  recordCall(outcome: 'allow' | 'deny' | 'error', usage?: { input_tokens?: number; output_tokens?: number }): void {
    const now = Date.now()
    const next: JevLocalUsage = { ...this.local }
    next.calls += 1
    if (outcome === 'allow') next.allowed += 1
    else if (outcome === 'deny') next.denied += 1
    else next.failed += 1
    next.inputTokens += usage?.input_tokens ?? 0
    next.outputTokens += usage?.output_tokens ?? 0
    if (next.since === 0) next.since = now
    next.lastCallAt = now
    this.local = next
  }

  /** The report the `jev/report` Remote returns (Host side of the boundary). */
  async report(): Promise<JevUsageReport> {
    const usageEndpoint = this.config.usageEndpoint()
    // Resolved per call, so a key pasted into the settings page flips the
    // card's empty state on the next refresh without a restart.
    const apiKey = await this.config.apiKey()
    return {
      configured: apiKey !== undefined,
      endpoint: this.config.endpoint(),
      usageEndpoint,
      model: this.config.model(),
      local: { ...this.local },
      // Without a usage endpoint there is nothing account-side to show, and
      // no error to report — the card renders the local layer alone.
      account: usageEndpoint === '' ? null : this.account,
      accountError: usageEndpoint === '' ? '' : this.accountError,
      accountFetchedAt: this.accountFetchedAt,
    }
  }

  /**
   * Fetch (or refetch) the account-side usage snapshot. Concurrent refreshes
   * collapse onto one request; a failure replaces the snapshot only when no
   * snapshot exists yet (stale data beats none).
   */
  async refreshAccount(): Promise<void> {
    if (this.inFlight !== undefined) return this.inFlight
    const usageEndpoint = this.config.usageEndpoint()
    const apiKey = await this.config.apiKey()
    if (apiKey === undefined || usageEndpoint === '') {
      this.account = null
      this.accountError = ''
      return
    }
    if (this.inFlight !== undefined) return this.inFlight
    this.inFlight = (async () => {
      try {
        this.account = await fetchAccountUsage({
          apiKey,
          usageEndpoint,
          timeoutMs: this.config.timeoutMs(),
        })
        this.accountError = ''
        this.accountFetchedAt = Date.now()
      } catch (error: unknown) {
        this.accountError = error instanceof Error ? error.message : String(error)
        if (this.account === null) this.accountFetchedAt = 0
      } finally {
        this.inFlight = undefined
      }
    })()
    return this.inFlight
  }
}

/**
 * Wire the usage service and its Remote contribution into the plugin. Rides
 * the optional `typert` registry service, so profiles without the web stack
 * never activate the Gateway side; the service itself is provided
 * unconditionally so the reviewer can always feed it counters.
 */
export function applyUsageRemote(ctx: Context, configSource: JevUsageConfigSource): JevUsageService {
  ctx.provide('jevUsageConfig', configSource)
  // The constructor's Service base registers `jevUsage` itself.
  const service = new JevUsageService(ctx)

  ctx.inject(['typert'], (remoteCtx) => {
    const registry = remoteCtx.typert as unknown as TypertContributionRegistry
    const unregister = registry.register(USAGE_HOST_CONTRIBUTION)
    // The registry's own effect would outlive this fiber; withdraw the
    // contribution when the plugin unloads.
    remoteCtx.effect(() => () => void unregister(), '@dsh-external/dsh-auto-review-jev: usage remote')
  })

  return service
}

export { JevError }
