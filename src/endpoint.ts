/**
 * Which destinations may carry the TypeSafe API key.
 *
 * Every request this plugin makes attaches the account's key as a Bearer
 * credential, so an endpoint that is not TLS-protected would publish it. The
 * rule is therefore a credential rule, not a URL-syntax rule: `https:` always,
 * `http:` only for loopback (a local proxy during development), everything else
 * refused.
 *
 * An empty value is outside this rule's remit — in the settings layer it means
 * "inherit the deployment's base value", and at the request boundary it is the
 * caller's own error to make. Callers that permit emptiness keep their own
 * guard.
 *
 * This module imports nothing, so both halves of the plugin can inline it: the
 * host entry and the browser bundle (`src/client/settings.ts` resolves the URL
 * a user types before it reaches the Host).
 *
 * @module @dsh-external/dsh-auto-review-jev/endpoint
 */

/** Loopback hosts that may be addressed over plain `http:`. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Why `raw` may not carry the API key, or undefined when it may.
 *
 * @param field - the setting name, used to name the offending value in the
 *   message (e.g. `endpoint`, `usageEndpoint`).
 * @param raw - the configured value; '' is always acceptable here.
 */
export function endpointProblem(field: string, raw: string): string | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return `${field} must be an absolute URL`
  }
  if (url.protocol === 'https:') return undefined
  // The WHATWG parser keeps the brackets on an IPv6 literal, so `[::1]` is a
  // literal comparison here.
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) return undefined
  return `${field} must use https (plain http is allowed only for localhost, 127.0.0.1 and [::1])`
}
