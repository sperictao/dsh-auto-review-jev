/**
 * Verdict memo for the reviewer, scoped to the request identity.
 *
 * A cached authorization verdict is only valid for the request that produced
 * it. The review STATE alone is not that request: `endpoint` and `model` are
 * live-editable from the settings page and the API key is re-resolved on every
 * call (`src/api-key.ts`), so a state-only key would replay a decision taken
 * against a previous endpoint, model or account for up to one TTL after the
 * change — silently, which is the worst property an authorization cache can
 * have.
 *
 * The second job is the growth bound: keys embed the tool arguments and the
 * session history (up to `maxStateChars` characters), so they are one-off by
 * nature and a long session would otherwise retain every distinct state it
 * ever asked about. Insertion sweeps what has expired, so the map holds only
 * the states asked about within one TTL window.
 *
 * @module @dsh-external/dsh-auto-review-jev/review-cache
 */

import type { ReviewDecision } from './reviewer.ts'

/** The request identity a cached decision is valid for. */
export interface ReviewIdentity {
  endpoint: string
  model: string
  apiKey: string
}

interface CacheEntry {
  readonly expiresAt: number
  readonly promise: Promise<ReviewDecision>
}

/** TTL'd, identity-scoped memo of in-flight and finished review decisions. */
export class ReviewCache {
  private readonly entries = new Map<string, CacheEntry>()
  private identity: ReviewIdentity | undefined

  constructor(private readonly ttlMs: number) {}

  /**
   * The promise cached for `key` under `identity`, or undefined.
   *
   * A TTL of zero (or less) disabled the cache, so this always misses.
   */
  get(identity: ReviewIdentity, key: string): Promise<ReviewDecision> | undefined {
    this.adopt(identity)
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt > Date.now()) return entry.promise
    this.entries.delete(key)
    return undefined
  }

  /** Cache `promise` for `key`; a rejection evicts the entry again. */
  set(identity: ReviewIdentity, key: string, promise: Promise<ReviewDecision>): void {
    if (this.ttlMs <= 0) return
    this.adopt(identity)
    this.sweep()
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, promise })
    void promise.catch(() => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key)
    })
  }

  /** Drop every entry (teardown). */
  clear(): void {
    this.entries.clear()
    this.identity = undefined
  }

  /** Entry count; observability for tests and long-session diagnostics. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Adopt `identity`, voiding every entry when it differs from the last one.
   *
   * Comparing the fields directly (rather than concatenating them into a
   * string) keeps the API key out of any derived value.
   */
  private adopt(identity: ReviewIdentity): void {
    const current = this.identity
    if (current !== undefined
      && current.endpoint === identity.endpoint
      && current.model === identity.model
      && current.apiKey === identity.apiKey) {
      return
    }
    this.entries.clear()
    this.identity = identity
  }

  /** Reclaim what has expired; deleting from a Map mid-iteration is safe. */
  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }
}
