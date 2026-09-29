# Plan 001: Scope the review cache to the live review identity

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1c758f6..HEAD -- src/index.ts src/review-cache.ts tests/review-cache.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness (security-adjacent: cached authorization verdicts)
- **Planned at**: commit `1c758f6`, 2026-09-23

## Why this matters

Jev's verdict for a tool call is cached so that identical review states do not
re-ask the model. The cache is keyed on the review state alone
(`JSON.stringify(state)`), but the *request* that produced a decision also
depends on the endpoint, the model and the API key — and all three can change
at runtime: the settings page writes `endpoint` / `model` into the durable
settings namespace and `JevLiveSettings` hands the new value to the very next
review (`src/index.ts:671` and `:678`), while the key is re-resolved on every call so a
key pasted into the page takes effect immediately (`src/api-key.ts:56-79`).
After such a change, up to `cacheSeconds` (default 120) of decisions taken
against the *previous* endpoint/model/key are replayed: an operator who switches
Jev deployments, or rotates a key, keeps getting verdicts from the old
configuration for two minutes, silently.

Second, the cache only ever loses an entry when that entry's exact key is looked
up again after expiry, or when the plugin unloads (`src/index.ts:887`). Keys are
one-off by nature (the state embeds the tool arguments and session history, up
to `maxStateChars` = 12,000 characters), so a long session accumulates every
distinct state it ever asked about and never reclaims the memory.

## Current state

Files this plan touches:

- `src/index.ts` — the plugin entry; `apply()` wires the pre-execute listener,
  `classify()` (line 699) asks Jev and caches the verdict.
- `src/review-cache.ts` — **does not exist yet**; this plan creates it.
- `tests/review-cache.test.ts` — **does not exist yet**; this plan creates it.

`src/index.ts:186-189` — the entry shape, defined next to `apply`:

```ts
interface CacheEntry {
  readonly expiresAt: number
  readonly promise: Promise<ReviewDecision>
}
```

`src/index.ts:628` — one cache per plugin instance:

```ts
  const cache = new Map<string, CacheEntry>()
```

`src/index.ts:723-756` — the lookup and the store, inside `classify`:

```ts
    const key = JSON.stringify(state)
    const now = Date.now()
    const cached = cache.get(key)
    if (cached !== undefined && cached.expiresAt > now) return cached.promise
    if (cached !== undefined) cache.delete(key)

    const promise = askJev({
      state,
      questions: REVIEW_QUESTIONS,
      apiKey,
      endpoint: live.read().endpoint,
      model: live.read().model,
      timeoutMs: live.read().timeoutMs,
      retries: config.retries,
      signal,
    }).then((response) => {
      const decision = evaluateReview(response, reviewThresholds)
      usage.recordCall(decision.decision === 'deny' ? 'deny' : 'allow', response.usage)
      return decision
    }, (error: unknown) => {
      usage.recordCall('error')
      throw error
    })

    if (config.cacheSeconds > 0) {
      cache.set(key, {
        expiresAt: now + Math.floor(config.cacheSeconds * 1000),
        promise,
      })
      void promise.catch(() => {
        if (cache.get(key)?.promise === promise) cache.delete(key)
      })
    }
    return promise
```

`src/index.ts:887` — the teardown path (inside the lifecycle effect's disposer),
which must keep working:

```ts
        cache.clear()
```

Repo conventions that apply:

- Every module here opens with a block comment explaining *why* the module
  exists, then `@module <package-relative path>`. See `src/api-key.ts:1-24` and
  `src/preset-binding.ts:1-18` for the shape. Match it.
- Public module APIs are declared with an `export interface` above the class and
  every member carries a short doc comment (`src/api-key.ts:35-58`).
- Type-only imports use `import type` (`verbatimModuleSyntax` is on in
  `tsconfig.json`).
- Tests are `vitest` files under `tests/`, named `<subject>.test.ts`, importing
  the subject with an explicit `.ts` extension: `import { ReviewCache } from
  '../src/review-cache.ts'`. See `tests/preset-binding.test.ts` as the structural
  pattern (small factories at the top, one `describe` per subject, plain
  `expect` assertions).

## Commands you will need

| Purpose   | Command                          | Expected on success                              |
|-----------|----------------------------------|--------------------------------------------------|
| Install   | `pnpm install`                   | exit 0                                           |
| Typecheck | `pnpm typecheck`                 | exit 0, no output beyond `$ tsc --noEmit`        |
| Tests     | `pnpm test`                      | exit 0, all files pass (75 tests before this plan) |
| One file  | `pnpm vitest run tests/review-cache.test.ts` | exit 0, new tests listed                |
| Build     | `pnpm build`                     | exit 0, `lib/index.js` + `lib/client.js` emitted |

## Scope

**In scope** (the only files you should modify):
- `src/review-cache.ts` (create)
- `src/index.ts`
- `tests/review-cache.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `src/client/**` and `src/usage-remote.ts` — the browser half and the usage
  Remote have their own state; nothing here concerns them.
- `CHANGELOG.md` and `package.json` — the repository's release flow
  (`scripts/release.sh`) owns the version and the changelog entry. Do not bump
  anything.
- The decision thresholds and `config.cacheSeconds` validation — the TTL stays
  boot-time configuration, exactly as today.
- The `usage.recordCall` accounting inside `classify` — a cache hit must keep
  counting as it does now (it does not: a hit does not re-record, which is
  unchanged by this plan; leave that behavior alone).

## Git workflow

- Branch: `advisor/001-scope-the-review-cache`
- Commit per step; message style matches `git log` in this repo: a short
  imperative summary, optionally `fix:` / `docs:` prefixed, e.g.
  `fix: key the review cache on the request identity, not the state alone`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `src/review-cache.ts`

Create the module with exactly this public shape (the doc comments follow the
repo convention — keep them, adjust wording if you like):

```ts
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

  /** The promise cached for `key` under `identity`, or undefined. */
  get(identity: ReviewIdentity, key: string): Promise<ReviewDecision> | undefined
  /** Cache `promise` for `key`; a rejection evicts the entry again. */
  set(identity: ReviewIdentity, key: string, promise: Promise<ReviewDecision>): void
  /** Drop every entry (teardown). */
  clear(): void
  /** Entry count; observability for tests and long-session diagnostics. */
  get size(): number
}
```

Behavior, which the tests in Step 3 pin down:

- `adopt(identity)` is a private method both `get` and `set` call first. It
  clears every entry when the identity differs from the last adopted one, then
  stores the new identity. Compare the three fields with `===`; do not build a
  string key from them (the API key must not be concatenated into anything).
- `get` returns the cached promise when `expiresAt > Date.now()`, deletes and
  returns `undefined` when it has expired, and `undefined` when absent. A
  cleared identity means `entries` is empty, so the identity change is what
  makes the old verdicts unreachable.
- `set` returns immediately when `ttlMs <= 0` (cache disabled), otherwise
  adopts, sweeps expired entries, stores `{ expiresAt: Date.now() + this.ttlMs,
  promise }`, and attaches `void promise.catch(...)` that deletes the entry when
  it is still the same promise (a failed review must not be memoized).
- `sweep()` iterates the map and deletes entries whose `expiresAt <= Date.now()`.
  Deleting from a `Map` during `for...of` iteration is safe. This is the growth
  bound: every insert reclaims what has expired, so the map holds only the
  distinct states asked about within one TTL window.
- `clear()` empties the map **and** resets `identity` to `undefined`, so a
  later `get` adopts fresh instead of assuming the last identity still holds.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Use it from `classify`

In `src/index.ts`:

1. Delete the local `CacheEntry` interface (lines 186-189) and add
   `import { ReviewCache, type ReviewIdentity } from './review-cache.ts'` next to
   the other `./…` imports at the top (keep the import block's ordering and the
   `type` modifier for the type-only import).
2. Replace line 628 with:

   ```ts
   const cache = new ReviewCache(Math.floor(config.cacheSeconds * 1000))
   ```

   `config.cacheSeconds` is validated in `validateConfig` (`src/index.ts:225-227`)
   as finite and non-negative, so no extra guard is needed. The TTL is
   boot-time configuration and stays that way.
3. Replace the lookup/store block quoted above (lines 723-756) with:

   ```ts
   const identity: ReviewIdentity = {
     endpoint: live.read().endpoint,
     model: live.read().model,
     apiKey,
   }
   const key = JSON.stringify(state)
   const cached = cache.get(identity, key)
   if (cached !== undefined) return cached

   const promise = askJev({
     state,
     questions: REVIEW_QUESTIONS,
     apiKey,
     endpoint: identity.endpoint,
     model: identity.model,
     timeoutMs: live.read().timeoutMs,
     retries: config.retries,
     signal,
   }).then((response) => { /* unchanged */ }, (error: unknown) => { /* unchanged */ })

   cache.set(identity, key, promise)
   return promise
   ```

   Keep the `.then(...)` bodies exactly as they are today (the
   `evaluateReview` + `usage.recordCall` pair). Note the call now reads
   `endpoint` / `model` once, into `identity`, and passes those same values to
   `askJev` — a review can no longer be keyed on one endpoint and sent to
   another.
4. Leave line 887 (`cache.clear()`) untouched; the class exposes the same method.

**Verify**: `pnpm typecheck` → exit 0; `pnpm test` → exit 0; `pnpm build` → exit 0.

### Step 3: Add `tests/review-cache.test.ts`

Write unit tests against the class directly. Use a helper that returns a
distinct settled promise per call so identity/key effects are observable:

```ts
const decision = (label: string): Promise<ReviewDecision> =>
  Promise.resolve({ risk: 'low', decision: 'allow', reasons: [label] })
```

`ReviewDecision` is exported from `src/reviewer.ts` — import it as a type
(`import type { ReviewDecision } from '../src/reviewer.ts'`).

Cases to cover, one `it` each:

1. **Coalesces**: `get` after `set` with the same identity and key returns the
   identical promise (`toBe`), not a re-ask.
2. **Endpoint change voids the cache**: after `set` under
   `{ endpoint: 'https://a.example', model, apiKey }`, a `get` under
   `{ endpoint: 'https://b.example', … }` returns `undefined`, and `size` is 0.
3. **Model change voids the cache**: same, varying only `model`.
4. **API-key change voids the cache**: same, varying only `apiKey`.
5. **Identity is re-adopted**: after a voiding `get` under a new identity, a
   second `set` + `get` under that new identity hits again (the class must not
   stay poisoned after the clear).
6. **Expiry**: with `vi.useFakeTimers()` and `vi.setSystemTime(...)`, an entry is
   returned at `ttl - 1` ms and `undefined` at `ttl + 1` ms (and `size` drops).
   Call `vi.useRealTimers()` in an `afterEach`.
7. **Rejection evicts**: `set` a promise that rejects; await it with
   `await expect(promise).rejects.toThrow()`; assert the next `get` returns
   `undefined` (flush the eviction with `await Promise.resolve()` if needed)
   and `size` is 0.
8. **TTL 0 disables the cache**: `new ReviewCache(0)` — `set` then `get` returns
   `undefined`, `size` is 0.
9. **Growth is bounded**: with fake timers, `set` 500 distinct keys spread over
   3× the TTL; assert `size` never exceeds the number of keys inserted within
   one TTL window (e.g. assert `size <= 200` given 500 inserts over 3 windows,
   or assert `size === 0` after advancing beyond the TTL and inserting one more
   key — the second form is exact and preferred).

**Verify**: `pnpm vitest run tests/review-cache.test.ts` → all new tests pass,
then `pnpm test` → exit 0 with the previous 75 tests still passing.

## Test plan

- New file `tests/review-cache.test.ts`, cases 1-9 above. Structural pattern:
  `tests/preset-binding.test.ts` (small local factories, plain assertions, no
  mocks beyond `vi`).
- The two behaviors this plan fixes each get a dedicated regression case: the
  identity case (2-4) and the growth case (9).
- Verification: `pnpm test` → exit 0; the summary must show the new test count
  (75 + the new cases).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 and `tests/review-cache.test.ts` passes
- [ ] `pnpm build` exits 0
- [ ] `grep -n "expiresAt" src/index.ts` returns no matches (the TTL
      bookkeeping lives in `src/review-cache.ts` now)
- [ ] `grep -n "interface CacheEntry" src/index.ts` returns no matches
- [ ] `git status --short` lists only `src/review-cache.ts`,
      `tests/review-cache.test.ts` and `src/index.ts`
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/index.ts:723-756` or `:628` does not match the excerpts
  above (the file has drifted since this plan was written).
- `src/reviewer.ts` no longer exports `ReviewDecision`, or it is not a plain
  discriminated union of the shape shown in Step 3.
- A test in Step 3 fails for a reason that suggests the *class design* is wrong
  (e.g. `get` must know about the caller's key to work) rather than the test
  being miswritten. That is a design signal, not a test bug — report it.
- You find a caller of the review cache outside `classify` (there should be
  exactly one call site for `get` and one for `set`).

## Maintenance notes

- If `cacheSeconds` ever becomes live-editable from the settings page, the TTL
  must stop being a constructor argument: the class would need a `setTtl` that
  re-stamps or clears existing entries. Today it is validated boot-time config
  (`src/index.ts:225-227`), which is why a fixed TTL is correct.
- Reviewers should scrutinize the identity comparison: it must cover **every**
  input that changes the HTTP request. `timeoutMs` and `retries` are deliberately
  not part of it (they do not change which verdict the service returns, only how
  hard we try), and the thresholds are boot-time config. If a new runtime-editable
  value ever reaches `askJev`, it belongs in `ReviewIdentity`.
- Deliberately deferred: reusing a cached verdict across *different* API keys is
  now impossible, which costs one extra review after a key rotation. That is the
  intended trade.
