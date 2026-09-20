/**
 * Effective API-key resolution for the reviewer and the usage poll.
 *
 * The key has three possible homes, and the ONE thing that must not happen is
 * a key a user saved from the settings page being stored but never read. So
 * every consumer goes through {@link JevApiKeyResolver}, which resolves per
 * call (never caches) in this order:
 *
 * 1. **Credential provider** (`ctx.credentials`) — the reference the settings
 *    page writes through. The provider's own source layers already include the
 *    process environment under the same reference name, so an exported
 *    `TYPESAFE_API_KEY` is found here too. Resolution is documented as
 *    per-operation precisely so a changed credential reaches the next
 *    operation without a restart.
 * 2. **Plugin config** — a deployment that put the key in its cordis entry.
 *
 * The value is never logged; callers redact it out of error text themselves.
 *
 * @module @dsh-external/dsh-auto-review-jev/api-key
 */

import { API_KEY_REF } from './wire-shared.ts'

// Re-exported so the package root keeps exposing the credential reference.
export { API_KEY_REF }

/** One resolved credential value and the layer that supplied it. */
export interface CredentialResolution {
  value: string
  /** Provider layer id (`env`, `file`, `project-env`, `user-env`, …). */
  source: string
}

/**
 * Structural face of the credential provider. Declared here rather than
 * imported so the plugin keeps no runtime dependency on the provider package:
 * a profile without it simply has no credential layer.
 */
export interface CredentialResolver {
  resolve(ref: string): Promise<CredentialResolution | undefined>
}

/** Where the resolver reads from. */
export interface JevApiKeySources {
  /** The credential provider, when the profile mounts one. */
  credentials(): CredentialResolver | undefined
  /** The plugin's own `apiKey` config (deployment fallback). */
  configured(): string
}

/**
 * Resolve the effective key per call.
 *
 * Not memoized on purpose: the credential provider's contract is that a
 * re-resolution is what makes a changed secret reach the next operation, and
 * the review path needs exactly that (a user pastes a key, the next tool call
 * uses it — no restart).
 */
export class JevApiKeyResolver {
  private readonly sources: JevApiKeySources

  constructor(sources: JevApiKeySources) {
    this.sources = sources
  }

  /**
   * @returns the effective key, or `undefined` when none is configured.
   *   A provider failure degrades to the config fallback rather than throwing:
   *   the reviewer's own "missing key" denial is the correct, legible outcome.
   */
  async resolve(): Promise<string | undefined> {
    const credentials = this.sources.credentials()
    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(API_KEY_REF)
        const value = resolved?.value?.trim()
        if (value !== undefined && value !== '') return value
      } catch {
        // Fall through to the config layer.
      }
    }
    const configured = this.sources.configured().trim()
    return configured === '' ? undefined : configured
  }
}
