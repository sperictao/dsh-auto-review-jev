# Plan 002: Refuse plaintext endpoints that would carry the API key

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1c758f6..HEAD -- src/endpoint.ts src/client.ts src/index.ts src/settings-namespace.ts src/client/settings.ts tests/endpoint.test.ts README.md README.zh-CN.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1c758f6`, 2026-09-23

## Why this matters

Both HTTP calls this plugin makes attach the account's TypeSafe API key as a
`Bearer` header, and both endpoints are user-supplied strings that are only
checked for being *absolute URLs*. An `http://` endpoint therefore sends the key
in plaintext: a typo, a hand-edited settings document, or a hostile profile
patch is enough, and the operator sees nothing — the reviewer just fails closed
with a generic `review_error` denial. The evaluation endpoint is not validated
at all at boot.

After this plan, an endpoint that is neither `https:` nor a loopback `http:`
address is refused in four places: the boot-time config check, the settings-page
save, the settings-page field state, and — as the last gate before the key is
attached — the two functions that build the request.

## Current state

- `src/client.ts` — the network module: `fetchAccountUsage()` (line 135, `GET`
  on the usage endpoint) and `postOnce()` (line 240, `POST` on the evaluation
  endpoint). Both attach the key unchanged:

  ```ts
  // src/client.ts:240-250
  async function postOnce(endpoint: string, body: string, call: JevCall): Promise<JevResponse> {
    const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = call.signal === undefined ? timeout : AbortSignal.any([call.signal, timeout])
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${call.apiKey}`,
        'Content-Type': 'application/json',
      },
  ```

  ```ts
  // src/client.ts:139-148
  const response = await fetch(call.usageEndpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      Accept: 'application/json',
    },
    signal,
  })
  ```

- `src/index.ts:231-237` — boot validation covers only `usageEndpoint`, and only
  for being absolute (the evaluation `endpoint` has no check at all):

  ```ts
  if (config.usageEndpoint !== '') {
    try {
      new URL(config.usageEndpoint)
    } catch {
      throw new Error('@dsh-external/dsh-auto-review-jev: usageEndpoint must be an absolute URL (or empty)')
    }
  }
  ```

- `src/settings-namespace.ts:101-110` — the durable settings write path has the
  same absolute-URL-only rule:

  ```ts
  function validateSettings(value: JevEditableSettings): void {
    for (const [field, raw] of [['endpoint', value.endpoint], ['usageEndpoint', value.usageEndpoint]] as const) {
      if (raw.trim() === '') continue
      try {
        new URL(raw)
      } catch {
        throw new Error(`${field} must be an absolute URL (or empty)`)
      }
    }
  ```

- `src/client/settings.ts:122-130` — the browser half marks a field invalid with
  the same weak rule; `line 212` applies it:

  ```ts
  function isAbsoluteUrlOrEmpty(text: string): boolean {
    if (text.trim() === '') return true
    try {
      new URL(text)
      return true
    } catch {
      return false
    }
  }
  ```

  ```ts
  // src/client/settings.ts:212
  invalid: field === 'model' ? false : !isAbsoluteUrlOrEmpty(text),
  ```

Repo conventions that apply:

- A new module opens with a block comment explaining *why* it exists, ending in
  `@module <path>`; see `src/api-key.ts:1-24`.
- The browser half may import a relative sibling module — `src/client/settings.ts:27`
  already does (`import { API_KEY_REF } from '../wire-shared.ts'`), and the
  bundler inlines it (`tsdown.config.ts`, the `client` config emits
  `lib/client.js` from `src/client/index.ts`). A new module that imports
  nothing may be shared by both halves. **Never** import `src/client.ts` (the
  host network module) from the browser half: that would pull `fetch`-and-retry
  code into the browser bundle.
- Validation errors in this repo name the field and state the rule
  (`'<field> must be …'`), and a refusal must reject the write so the settings
  page raises its banner (see `src/settings-namespace.ts:96-100`).

## Commands you will need

| Purpose   | Command                                       | Expected on success                        |
|-----------|-----------------------------------------------|--------------------------------------------|
| Install   | `pnpm install`                                | exit 0                                     |
| Typecheck | `pnpm typecheck`                              | exit 0                                     |
| Tests     | `pnpm test`                                   | exit 0 (75 tests before this plan)         |
| One file  | `pnpm vitest run tests/endpoint.test.ts`      | exit 0                                     |
| Build     | `pnpm build`                                  | exit 0, `lib/index.js` + `lib/client.js`   |

## Scope

**In scope** (the only files you should modify):
- `src/endpoint.ts` (create)
- `src/client.ts`
- `src/index.ts`
- `src/settings-namespace.ts`
- `src/client/settings.ts`
- `tests/endpoint.test.ts` (create)
- `README.md`, `README.zh-CN.md` (one sentence each, see Step 6)

**Out of scope** (do NOT touch, even though they look related):
- `src/usage-remote.ts` — it calls `fetchAccountUsage`, which enforces the rule
  itself; no change needed there.
- Any proxy support (`https_proxy` / `HTTP_PROXY`), custom CA bundles, or
  self-signed-certificate options. Out of scope: this plan decides *which URLs
  may carry the key*, not how the TLS connection is made.
- `CHANGELOG.md` and `package.json` — the release flow owns them. Note in your
  report that this behavior change needs a changelog entry at the next release.
- `src/index.ts`'s other validation rules (thresholds, `preset`, timeouts) except
  the endpoint loop quoted above.

## Git workflow

- Branch: `advisor/002-refuse-plaintext-endpoints`
- Commit per step; message style matches `git log`, e.g.
  `fix: refuse endpoints that would send the API key over plaintext`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `src/endpoint.ts`

Create the shared predicate. It must import nothing (both bundles inline it):

```ts
/**
 * Which destinations may carry the TypeSafe API key.
 *
 * Every request this plugin makes attaches the account's key as a Bearer
 * credential, so an endpoint that is not TLS-protected would publish it. The
 * rule is therefore a credential rule, not a URL-syntax rule: `https:` always,
 * `http:` only for loopback (a local proxy during development), everything
 * else refused.
 *
 * An empty value is outside this rule's remit — in the settings layer it means
 * "inherit the deployment's base value", and at the request boundary it is the
 * caller's own error to make. Callers that permit emptiness keep their own
 * guard.
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
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) return undefined
  return `${field} must use https (plain http is allowed only for localhost, 127.0.0.1 and [::1])`
}
```

Notes the executor should keep in mind (each verified with Node 26 on this
machine): `new URL('https://api.typesafe.ai/v1').protocol` is `'https:'`; for
`http://[::1]:8080/v1` the `hostname` property is `'[::1]'` (brackets kept), so
the literal comparison above is correct; `new URL('not a url')` throws; a bare
`https://` throws.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Refuse at the two request boundaries

In `src/client.ts`, import the helper and guard both request builders, which
together are the only places the key is attached to a socket:

1. `postOnce` (line 240) — add after the signature, before the timeout is built:

   ```ts
   const problem = endpointProblem('endpoint', endpoint)
   if (problem !== undefined) throw new JevError(problem)
   ```

   `JevError`'s third argument defaults to `retryable = false`, which is what we
   want: `askJev` rethrows a non-retryable failure immediately
   (`src/client.ts:111-121`), so no retry loop spins on a misconfiguration.

2. `fetchAccountUsage` (line 135) — same guard first, with the field name
   `'usageEndpoint'`.

Why both the config check and this one: a value already stored in the settings
document (written by an earlier version, or hand-edited) is loaded into the live
holder without passing today's validator, and this is the last point before the
credential is attached to a request.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Boot-time config validation

In `src/index.ts`, replace the `usageEndpoint` block (lines 231-237) with a loop
over both endpoints, in the same shape the settings layer uses:

```ts
for (const [field, raw] of [['endpoint', config.endpoint], ['usageEndpoint', config.usageEndpoint]] as const) {
  const problem = endpointProblem(field, raw)
  if (problem !== undefined) throw new Error(`@dsh-external/dsh-auto-review-jev: ${problem}`)
}
```

Keep the existing error-prefix convention (`@dsh-external/dsh-auto-review-jev:`).

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Settings-write validation

In `src/settings-namespace.ts`, replace the body of the endpoint loop in
`validateSettings` (lines 102-109) with the shared rule, keeping the
empty-means-inherit guard exactly as it is:

```ts
for (const [field, raw] of [['endpoint', value.endpoint], ['usageEndpoint', value.usageEndpoint]] as const) {
  if (raw.trim() === '') continue
  const problem = endpointProblem(field, raw)
  if (problem !== undefined) throw new Error(problem)
}
```

Do not add any other rule to this function.

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Browser field state

In `src/client/settings.ts`:

1. Delete `isAbsoluteUrlOrEmpty` (lines 122-130) and import `endpointProblem`
   from `../endpoint.ts`.
2. Replace line 212 with:

   ```ts
   invalid: field === 'model' ? false : endpointProblem(field, text) !== undefined,
   ```

This keeps empty drafts valid (clearing `endpoint` means "inherit the
deployment's base value", clearing `usageEndpoint` disables account polling —
both are supported affordances today) while marking an insecure URL invalid
before the user hits save.

**Verify**: `pnpm typecheck` → exit 0; `pnpm build` → exit 0.

### Step 6: Say so in both READMEs

Add one sentence to the endpoint documentation in `README.md` and its mirror
`README.zh-CN.md` (keep the two in sync — every config option is documented in
both): the endpoints must be `https`, and plain `http` is accepted only for
loopback hosts (`localhost`, `127.0.0.1`, `[::1]`), because the API key is sent
as a Bearer credential.

**Verify**: `grep -c "loopback\|127.0.0.1" README.md README.zh-CN.md` → each file
reports at least 1.

### Step 7: Tests

Create `tests/endpoint.test.ts` with three groups.

**Group A — the predicate** (`endpointProblem`), one `it` per case:

| Input | Expected |
|-------|----------|
| `'https://api.typesafe.ai/v1'` | `undefined` |
| `'  https://api.example/v1  '` (surrounding whitespace) | `undefined` |
| `'http://localhost:8080/v1'` | `undefined` |
| `'http://127.0.0.1/v1'` | `undefined` |
| `'http://[::1]:8080/v1'` | `undefined` |
| `'http://api.example/v1'` | message matching `/https/` |
| `'ftp://api.example/v1'` | message matching `/https/` |
| `'file:///etc/passwd'` | message matching `/https/` |
| `'not a url'` | message matching `/absolute URL/` |
| `'https://'` | message matching `/absolute URL/` |
| `''` and `'   '` | `undefined` |

Assert the field name appears in the message: `endpointProblem('usageEndpoint',
'http://x.example').toContain('usageEndpoint')`.

**Group B — the request boundary**. Both cases must reject *before* any network
access (that is what makes them deterministic — no fetch mock is needed):

```ts
await expect(fetchAccountUsage({ apiKey: 'k', usageEndpoint: 'http://api.example/v1' }))
  .rejects.toThrow(/https/)
```

For the evaluation endpoint, call `askJev` with a real state fixture. Build it
the way `tests/reviewer.test.ts` already does:

```ts
await expect(askJev({
  state,                          // the same fixture tests/reviewer.test.ts builds
  questions: REVIEW_QUESTIONS,    // exported from src/reviewer.ts
  apiKey: 'k',
  endpoint: 'http://api.example/v1',
  retries: 0,
  signal: new AbortController().signal,
})).rejects.toThrow(/https/)
```

Use `retries: 0` so a hypothetical bug cannot turn this into a retry storm.
`JevError` is exported from `src/client.ts` if you want to assert the type.

**Group C — the settings write refusal**. Drive the real registration path with a
capturing fake context, so the wiring (not just the helper) is covered:

```ts
const captured: { validate?: (value: JevEditableSettings) => void } = {}
const ctx = {
  inject: (_names: string[], callback: (ctx: unknown) => void) => {
    callback({
      settings: {
        register: (_ns: string, _schema: unknown, options: { validate: (value: JevEditableSettings) => void }) => {
          captured.validate = options.validate
          return { get: () => ({ ...BASE }), watch: () => () => {} }
        },
      },
    })
    return () => {}
  },
} as unknown as Context
applySettingsNamespace(ctx, BASE, new JevLiveSettings(BASE))

expect(captured.validate).toBeTypeOf('function')
expect(() => captured.validate!({ ...BASE, endpoint: 'http://api.example/v1' })).toThrow(/https/)
expect(() => captured.validate!({ ...BASE, endpoint: 'https://api.example/v1' })).not.toThrow()
```

with `BASE` a valid `JevEditableSettings` literal (`{ endpoint:
'https://api.typesafe.ai/v1', usageEndpoint: '', model: 'jev-latest', timeoutMs:
30_000, usageRefreshSeconds: 300 }`) and `Context` imported as a type from
`@deepseek-ai/cordis`. Follow `tests/settings.test.ts` for the fake-context style.

*Boot-time* validation (Step 3) is not covered here — `validateConfig` is
private to `src/index.ts`; plan `003-authorization-lifecycle-tests.md` covers it
through `apply()`. Do not export `validateConfig` just for this test.

**Verify**: `pnpm vitest run tests/endpoint.test.ts` → all pass; then `pnpm test`
→ exit 0 with the 75 pre-existing tests still passing.

## Test plan

- New file `tests/endpoint.test.ts`, groups A/B/C above (roughly 15 cases).
- Regression cases specific to this plan: the `http://` non-loopback refusal at
  the helper (A), at the request boundary (B) and at the settings write (C), plus
  the loopback allowances so the development path cannot be broken silently.
- Structural pattern: `tests/settings.test.ts` (small local fakes, plain
  assertions, no network).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; `tests/endpoint.test.ts` passes
- [ ] `pnpm build` exits 0 and both `lib/index.js` and `lib/client.js` exist
- [ ] `grep -rn "isAbsoluteUrlOrEmpty" src/` returns no matches
- [ ] `grep -rn "new URL(" src/ | grep -v "src/endpoint.ts"` returns no matches
      in `src/index.ts`, `src/settings-namespace.ts`, `src/client/settings.ts`
      (the URL parsing now lives in one place)
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited lines does not match the excerpts (the file has drifted).
- `src/client.ts` turns out to have a third place that attaches the
  `Authorization` header (grep for `Authorization` before finishing — it must be
  only the two guards' call sites).
- A test in Group B or C fails for a reason other than the new rule (for
  example, `fetchAccountUsage` starts validating `apiKey` too, or
  `applySettingsNamespace` no longer takes `(ctx, initial, live)`).
- You are tempted to make the rule configurable (an `allowInsecure` option, an
  env override, a per-profile exception). Do not: report the request instead.
  The whole point is that there is one rule.

## Maintenance notes

- The rule now lives in exactly one place. Any future endpoint-shaped setting
  must call `endpointProblem` rather than re-implementing a URL check; a
  reviewer should reject a bare `new URL(...)` in review.
- Delegating TLS to a proxy (`https_proxy`, a corporate MITM) is unaffected: the
  rule constrains the *destination* scheme only. A local TLS-terminating proxy
  is reachable as `http://127.0.0.1:…` when it speaks plain HTTP to the client.
- An empty `endpoint` still passes config validation (it means "inherit" in the
  settings layer) and fails closed at the request boundary. If you want a boot
  error for it, that is a separate, deliberate behavior change — not part of
  this plan.
- `CHANGELOG.md` needs an entry for this behavior change at the next release;
  `scripts/release.sh` owns the version and takes the notes from that section.
