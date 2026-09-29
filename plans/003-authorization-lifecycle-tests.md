# Plan 003: Cover the authorization lifecycle with integration tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1c758f6..HEAD -- src/index.ts tests/lifecycle.test.ts`
> If `src/index.ts` changed since this plan was written, re-read the quoted
> regions before proceeding; the fixture in Tier 2 depends on their exact
> behavior. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW (test-only; no production file is modified)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `1c758f6`, 2026-09-23

## Why this matters

`src/index.ts` holds the entire authorization lifecycle: the
`tools/pre-execute` listener that decides every tool call, the engagement gate
that keeps this plugin from double-reviewing a preset another integration owns,
the fail-closed denial paths, the human-reprieve path, and the teardown that
aborts in-flight work and restores the session's preset. **No test file imports
`src/index.ts`**: all eight existing suites cover leaf modules (`api-key`,
`denial`, `reviewer`, `ask-on-deny`, `preset-binding`, `settings`, `usage`,
`constants`), and the aggregate behavior — "a denied call is blocked, an
unavailable reviewer never allows anything, an unloaded plugin stops deciding" —
is verified by nothing but reading the code. A regression in the listener's
return values silently converts a fail-closed guardrail into an allow, or blocks
work with no explanation.

This plan adds the missing integration coverage. It changes no production file,
so it cannot regress the plugin — but it must not be "fixed" by loosening the
production code to make a test pass.

## Current state

Facts that make this testable without the DeepSeek Harness runtime:

- `src/index.ts` imports exactly three values from peer packages:
  `AUTO_PRESET` / `CUSTOM_PRESET` from `@deepseek-ai/dsh-permission-presets`,
  `RUN_CODE_NAME` from `@deepseek-ai/dsh-tools`, and `z` from
  `@deepseek-ai/schemastery`. Everything else is `import type`. All three are
  installed as `devDependencies`, and both peer values are already imported by
  passing tests (`tests/preset-binding.test.ts` imports the preset package),
  so a test can import `src/index.ts` directly. Verified on this machine:
  `node --experimental-strip-types --input-type=module -e "const m = await
  import('./src/index.ts'); console.log(typeof m.apply)"` prints `function`.
- The plugin entry is `apply(ctx, config)` (`src/index.ts:624`), exported along
  with `name` and `inject = ['permissionPresets', 'sessions', 'tools']`.
- The context faces `apply` actually touches (read the code before writing the
  fake; this list is from commit `1c758f6`):
  - `ctx.permissionPresets` — `.current(session)`, `.set(session, name)`,
    `.names`, `.registerAuto(admit)`
  - `ctx.inject(['credentials'], cb)` — optional credential provider
  - `ctx.inject(['settings'], cb)` — inside `applySettingsNamespace` (src/settings-namespace.ts:129)
  - `ctx.provide('jevUsageConfig', …)` and `new JevUsageService(ctx)` — inside
    `applyUsageRemote` (src/usage-remote.ts:174)
  - `ctx.on('tools/pre-execute', handler, { prepend: true })` — line 776
  - `ctx.effect(function* …)` — the lifecycle generator, starting at line 786
  - `ctx.sessions.list()` — teardown, line 880
  - `ctx.get('userQuestions')` — the soft seam lookup inside `createDenialAsker`
- The listener's decision surface (`src/index.ts:776-841`), in order:

  ```ts
  const stopListener = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const agent = exec.agent
    if (agent === undefined || (exec.parent === undefined && exec.name === RUN_CODE_NAME)) {
      return next()
    }
    if (!engaged) return next()
    if (permissionPresets.current(agent.session) !== presetName) return next()
    if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }
    // … resolve the key, ask Jev, then: denyAfterAsk / next() / { kind: 'cancel' }
  ```

- `classify` throws `missing ${API_KEY_REF}` **before** `snapshotReview` runs
  when no key is configured (`src/index.ts:699-705`). Tier 1 below relies on
  this: the fail-closed path needs no session fixture.
- The deny decision's shape (`src/denial.ts:45-55`) — assert against this, not
  against prose: `{ kind: 'deny', reason: <one-line reason>, info: { name:
  DENIED_ERROR_NAME, code: DENIED_ERROR_CODE, reason?: <the detail> } }`. The
  caller's `detail` is appended to `reason` and repeated in `info.reason`
  (`rejectionReason`, `src/denial.ts:33-35`), so `review_error: …` and
  `missing TYPESAFE_API_KEY` are both visible in `reason`.
- The teardown disposer (`src/index.ts:877-890`) sets `accepting = false`, walks
  `ctx.sessions.list()` resetting every session whose preset is `AUTO_PRESET` to
  `'danger-full-access'`, aborts `lifecycle`, awaits `active`, and clears the
  cache.
- Test conventions: `vitest`, files under `tests/`, subject imported with an
  explicit `.ts` extension, small local fakes instead of a mocking library where
  possible. `tests/preset-binding.test.ts` is the closest structural pattern; it
  builds a `PresetBinder` fake in five lines.

## Commands you will need

| Purpose    | Command                                    | Expected on success                       |
|------------|--------------------------------------------|-------------------------------------------|
| Install    | `pnpm install`                             | exit 0                                    |
| Typecheck  | `pnpm typecheck`                           | exit 0 (test files are type-checked)      |
| Tests      | `pnpm test`                                | exit 0 (75 tests before this plan)        |
| One file   | `pnpm vitest run tests/lifecycle.test.ts`  | exit 0                                    |
| One case   | `pnpm vitest run -t "<test name>"`         | exit 0                                    |

## Scope

**In scope** (the only files you should modify):
- `tests/lifecycle.test.ts` (create — the one deliverable)

**Out of scope** (do NOT touch):
- **Every file under `src/`.** This plan adds tests only. If a test cannot be
  written without changing production code, that is a STOP condition — report
  which assertion needed which change instead of making it.
- `vitest.config.*` — none exists; the defaults (`tests/**/*.test.ts`, Node
  environment) already work for the suites in this repo.
- Coverage thresholds, CI workflow changes, or new test dependencies. Use only
  `vitest` and `node:*` builtins.

## Git workflow

- Branch: `advisor/003-authorization-lifecycle-tests`
- One commit for the harness plus Tier 1, a second for Tier 2 — the first must
  stand on its own if Tier 2 hits a STOP condition.
- Message style matches `git log`, e.g.
  `test: cover the pre-execute listener's fail-closed paths`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the fake context

Write `tests/lifecycle.test.ts`. Start with the harness. Shape it exactly like
this (the semantics matter more than the names; follow the repo's comment
style — say *why* a fake behaves the way it does):

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

vi.mock('../src/usage-remote.ts', () => ({
  // The real service extends the Typert Remote base, which needs a live Cordis
  // context. The listener under test only calls recordCall/refreshAccount, so
  // the lifecycle tests stub the service and keep the Typert stack out.
  applyUsageRemote: () => ({ recordCall: () => {}, refreshAccount: async () => {}, report: async () => ({}) }),
}))

vi.mock('../src/client.ts', async (importOriginal) => ({
  // Keep the real constants and JevError; replace only the network call.
  ...(await importOriginal<typeof import('../src/client.ts')>()),
  askJev: vi.fn(),
}))
```

Then a `harness(options)` factory returning `{ ctx, config, askJev, listener, dispose, presets, session, requests }`:

- `config`: a full `Config` literal — copy every field from the `Config` schema
  defaults (`src/index.ts:108-130`) with `apiKey: 'test-key'`,
  `cacheSeconds: 0` (no cross-test cache bleed; plan 001 keeps this field
  working the same way), `askOnDeny` as the test needs it, and `preset: 'auto'`
  unless the test says otherwise.
- `presets`: `{ names: [...], registerAuto: () => async () => {}, current: (s) => presetBySession.get(s), set: (s, name) => presetBySession.set(s, name) }`
  as a plain object cast to the expected shape.
- `session`: an object literal cast to the `Agent['session']` type — Tier 1 tests
  never reach it; Tier 2 builds it (Step 4).
- `ctx`: a plain object cast to `Context` implementing only what `apply` uses:
  - `permissionPresets` — the fake above.
  - `sessions: { list: () => [session] }`
  - `on: (event, handler, _options) => { listener = handler; return () => {} }` —
    record the handler; the fake never dispatches events itself.
  - `provide: () => {}`
  - `get: (name) => (name === 'userQuestions' ? seam : undefined)` — `seam` is
    `undefined` unless the test supplies one (this is the plugin's soft lookup).
  - `effect: (callback) => { … }` — run a generator callback eagerly,
    collecting every yielded value; return a disposer that calls them in
    reverse order, awaiting anything thenable. This is what makes
    `ctx.effect(function* () { … yield stopListener … })` register the listener
    at `apply()` time and run the teardown on dispose.
  - `inject: (names, callback) => { … }` — invoke `callback(thisFakeCtx)` only
    for names present in an `options.services` map, then return a disposer that
    calls the callback's returned function if it returned one. Services absent
    from the map are modelled as "this profile has no such provider": validating
    the credential fallback and the headless (no `settings`) path. The
    credentials provider lives in that map when a test supplies one.
- `requests`: if you need to know whether the listener asked Jev, assert on the
  `askJev` mock (`vi.mocked(askJev).mock.calls.length`) rather than adding a spy.

Call `apply(ctx, config)` once per `harness()` and return the captured
`listener`. `exec` fixtures are plain object literals cast to `ToolExecution`:
`{ agent, name: 'bash', arguments: { command: 'ls' }, rootCallId: 'call-1', parent: undefined, signal: new AbortController().signal }`.

Reset the module-level mock between tests (`vi.mocked(askJev).mockReset()` in
`beforeEach`) and use `vi.useRealTimers()` if you ever enable fake timers.

**Verify**: `pnpm typecheck` → exit 0. Then a placeholder test asserting
`apply(ctx, config)` does not throw and that `listener` is a function —
`pnpm vitest run tests/lifecycle.test.ts` → exit 0.

### Step 2 (Tier 1): the paths that need no session

Each case below is an `it` in `tests/lifecycle.test.ts`. `next` is
`vi.fn(() => ({ kind: 'allow' }))` (whatever shape you like — what matters is
that the listener *calls* it or does not).

1. **Disengaged passthrough** — build the harness with
   `registerAuto: () => { throw new Error('permission: preset "auto" is already registered') }`
   (the state another Auto integration creates) and assert the listener calls
   `next()` and `askJev` is never called.
2. **Foreign preset** — `config.preset = 'auto-jev'`, `presets.names = ['auto-jev']`,
   session's current preset = `'workspace-write'` → `next()`, no `askJev`.
3. **Missing key fails closed** — `config.apiKey = ''` and no credentials
   service in the harness: the returned decision is `{ kind: 'deny', … }` (not
   `next()`), its `reason` contains `TYPESAFE_API_KEY` (the `API_KEY_REF`
   constant), and `askJev` is never called. With `config.askOnDeny = false`, no
   question is asked either — assert that by supplying no `userQuestions` seam
   and asserting the decision is still a deny.
4. **Review error fails closed** — `askJev` rejects with `new Error('boom')`:
   the returned decision is a deny whose `reason` contains `review_error`, and —
   with a `userQuestions` seam supplied that answers "run it anyway" — the denial
   is *lifted* (`next()` is returned) because the human may override. Assert both
   halves in one case: the denial when `askOnDeny: false`, the reprieve when the
   seam answers an allow.
5. **Reprieve denied** — seam answers the deny option (or returns an empty
   `answers` array) → the listener still denies, and the deny's `reason` carries
   the `keepDeniedNote` suffix in parentheses (the listener appends it to the
   detail, `src/index.ts:818-822`). `tests/ask-on-deny.test.ts` has the answer payload
   shapes; reuse one verbatim.
6. **Abort/dispose cancels instead of allowing** — call the harness disposer
   (the lifecycle effect's), then invoke the captured listener: it returns
   `{ kind: 'cancel' }` and never calls `askJev`. Assert too that teardown reset
   the session's preset: `presets.current(session)` is `'danger-full-access'`
   when it was `AUTO_PRESET` before.
7. **Root `run_code` is never reviewed** — `exec.name = RUN_CODE_NAME` with
   `parent: undefined` → `next()`. (Import `RUN_CODE_NAME` from
   `@deepseek-ai/dsh-tools`.) Also cover `exec.agent === undefined` → `next()`.
8. **Boot validation refuses an insecure endpoint** — after plan 002 lands,
   `apply(ctx, { ...config, endpoint: 'http://api.example/v1' })` throws a
   message matching `/https/`. If plan 002 has *not* landed yet, assert instead
   that `apply` throws for a bad `usageEndpoint`
   (`usageEndpoint: 'not a url'`) — that check exists today
   (`src/index.ts:231-237`). Do not skip this case.
9. **Two instances do not share a cache** — build two harnesses whose `askJev`
   mocks return different decisions for the same state; call each listener with
   an identical `exec`; assert each one's decision comes from its own mock. If
   this cannot be expressed without the Tier 2 session fixture, move it to Tier
   2 and say so in your report.

**Verify**: `pnpm vitest run tests/lifecycle.test.ts` → all Tier 1 cases pass.

### Step 3 (Tier 2): a minimal session fixture

The allow/deny paths go through `snapshotReview` (`src/index.ts:473`), which
reads the session log. Build the smallest log that satisfies it. It requires
(follow the code — these are the constraints at `1c758f6`):

- `session.snapshotEvents()` → an array where **`events[seq] === event`**, i.e.
  `seq` equals the array index.
- `session.surface.nodes` → the seq numbers to walk, in order.
- `session.requestHeader()` → `{ tools: [...] }` containing **exactly one**
  schema whose `name` equals `exec.name`, with a string `description` and a
  record `parameters`.
- `session.header.cwd` → a non-empty string. `session.header.origin` → anything
  other than `'subagent'` (so the direct-parent walk is skipped).
- `exec` must match the logged call: `exec.name` equals the `tool/call` event's
  `data.name`, and `exec.arguments` deep-equals `JSON.parse(data.arguments)` (the
  event stores arguments as a JSON *string*).
- The assistant message's `tool-call` block must spell its `arguments` as the
  **identical string** the `tool/call` event carries: `snapshotReview`'s
  visible-call check compares the two with `===`. An object literal there throws
  `visible tool call disagrees with its logged action`, which surfaces as a
  `review_error` denial rather than as a test failure that names the fixture.
  This is the single easiest way to get the fixture wrong.

The fixture (adapt names to taste; keep the ordering):

```ts
let seq = 0
const events = [
  { seq: seq++, type: 'user/message',
    data: { source: { kind: 'user', rpcId: 'rpc-1' }, content: [{ type: 'text', text: 'list the files' }] } },
  { seq: seq++, type: 'step/start', data: { turn: 1, step: 1 } },
  { seq: seq++, type: 'assistant/message',
    // The block's arguments must be the SAME string the tool/call event logs.
    data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"ls"}' }] } } },
  { seq: seq++, type: 'tool/call',
    data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' } },
]

const session = {
  header: { cwd: '/tmp/work' },
  isOwnSeq: () => true,
  snapshotEvents: () => events,
  surface: { nodes: [0, 1, 2, 3] },
  requestHeader: () => ({ tools: [{ name: 'bash', description: 'run a shell command', parameters: { type: 'object' } }] }),
} as unknown as Agent['session']
```

The key detail: the `assistant/message` block's `id` must equal
`exec.rootCallId`, and the `step/start` must open the same `{ turn: 1, step: 1 }`
the `tool/call` and the `exec` fixture claim — that is how `snapshotReview`
proves the pending call belongs to the current step. A mismatch throws, the
thrown error becomes `review_error: …`, and your allow-path test would fail with
a denial instead of an allow. When that happens, read the thrown message: it
names the missing piece (`pending root call is missing or ambiguous`,
`pending tool schema is missing or ambiguous`, …) — fix the fixture, not the
production code.

Read the surrounding code before you start: `snapshotReview`, `scopePtcStarts`
(line 391), `nativeAction` (line 417), and the `stepIdentity` / `sameStep` /
`scopedCallKey` helpers (lines 379-389).

### Step 4 (Tier 2): the decide paths

1. **Allow** — `askJev` resolves with a response that `evaluateReview` turns into
   an allow. Copy the response fixture from `tests/reviewer.test.ts`, which
   already builds pass/fail answer sets for the seven review questions. The
   listener must return `next()` (not a denial) and `askJev` must be called
   once, with `endpoint` / `model` / `apiKey` from the harness config.
2. **Deny** — `askJev` resolves with a high-risk answer set: the listener returns
   a denial whose text names the risk and reasons (`decisionDetail`,
   `src/index.ts:619-622`), and `askJev` is called once.
3. **Cache reuse** — with `config.cacheSeconds = 120`, invoke the listener twice
   with the same `exec`: `askJev` must be called **once** and the second call
   returns the same decision. (This is the behavior plan 001 re-keys; keeping the
   case here means a future cache change has end-to-end cover. If plan 001 has
   already landed, the assertion is unchanged — it asserts observable behavior,
   not the cache's internals.)
4. **Key rotation is observed** — with the credentials service in the harness
   map returning a different key on the second resolution, the second call must
   reach `askJev` with the new key. (With plan 001 landed this also exercises
   the identity change; without it, the state-only key would still ask again
   because each call passes a different key to `askJev`. Assert what the mock
   received.)

**Verify**: `pnpm vitest run tests/lifecycle.test.ts` → all cases pass.

## Test plan

- New file `tests/lifecycle.test.ts`: the harness plus 9 Tier 1 cases and 4
  Tier 2 cases (adjust the count if a case is genuinely unexpressible — say so
  in the report; do not delete a case silently).
- Structural pattern: `tests/preset-binding.test.ts` for fake-service style, and
  `tests/reviewer.test.ts` for the Jev response fixtures.
- Every case must be deterministic: no real network (the network call is
  mocked), no real timers, no dependence on test execution order. A case that
  passes only when run alone is a bug — run the file twice and once as part of
  `pnpm test`.
- Verification: `pnpm test` → exit 0, with the new file's cases counted in the
  summary.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; `tests/lifecycle.test.ts` passes both standalone and
      in the full run
- [ ] `vi.mocked(askJev)` is asserted in at least the allow, deny, cache and
      key-rotation cases
- [ ] `git status --short` lists **only** `tests/lifecycle.test.ts`
      (plus the plan files if the operator tracks them)
- [ ] `git diff --stat 1c758f6..HEAD -- src/` is empty (no production change)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The listener body or `snapshotReview` no longer matches the excerpts above
  (`src/index.ts` drifted).
- The Tier 2 fixture cannot satisfy `snapshotReview` after a reasonable effort,
  or satisfying it seems to need a production change (for example, a helper that
  is not exported). Report the thrown message and which constraint failed, and
  land Tier 1 on its own — Tier 1 is the minimum deliverable and must not be
  held hostage by Tier 2.
- A test can only pass by importing internals through `as any` on production
  types, or by re-implementing a decision rule inside the test. Both mean the
  test would assert the test, not the code — report instead.
- You conclude the mock of `../src/usage-remote.ts` is masking real breakage
  (it should not: the lifecycle tests never assert usage counters). Say what you
  observed.

## Maintenance notes

- The harness is the seed for the deferred refactor of `src/index.ts` (see the
  "Deferred" section of `plans/README.md`): once these tests exist, splitting
  `snapshotReview` / the listener out of the entry becomes a verifiable change.
  Keep the harness free of assertions about *how* the decision is made, so it
  survives that refactor.
- These tests deliberately drive the listener directly rather than through a
  real Cordis context. They therefore do **not** cover: event dispatch order
  against other integrations, `inject` waiting semantics, or the real
  `ConfigForm` wiring — those need the harness itself, not this plugin.
- Adding a decision-relevant config field means extending the harness `config`
  literal (it must stay a complete `Config`, so a new required field breaks the
  build rather than silently taking a default).
- If the listener's return-value contract ever changes (`PreToolDecision` gains a
  kind), every case here asserts on the listener's return value, so the failures
  will point straight at the contract.
