# Changelog

Notable changes to `@dsh-external/dsh-auto-review-jev`. Each version matches a
[git tag](https://github.com/sperictao/dsh-auto-review-jev/tags) and a GitHub
Release carrying a prebuilt tarball.

## 0.2.7

- **Adapted to DeepSeek Harness 0.1.7-alpha.1.** Two breaking upstream changes
  reach this plugin, one per half.
  - The message-source vocabulary lost its catch-all `plugin` kind, so a
    compaction summary is now identified by the `compact-checkpoint` source
    kind rather than `kind: 'plugin'` + `plugin: 'compact'`. The check reads
    that discriminant structurally: the kind is declared in the compaction
    plugin's own module, which this plugin deliberately does not depend on.
  - The browser settings service was renamed. `ctx.settingsScope.bind({ … })`
    is now `ctx.configForms.get(namespace)`, and the injected key
    `settingsScope` is now `configForms`.
- **A refused settings write now fails the save.** `ConfigForm.set` / `unset`
  answer the Host's acceptance — `false` when the namespace's own validation
  refuses the value — where the old scope settled silently. `save()` treats a
  refusal as a failure, so the page raises its error banner instead of
  reporting success for a value that never landed.
- **Peer ranges are now `^0.1.7-alpha.1` alone.** The previous ranges reached
  back to `0.1.2-rc.1`; the browser half cannot load without `configForms` and
  the host half no longer recognises a 0.1.6 checkpoint source, so keeping
  them would have advertised support that no longer exists.
- The dual-generation Remote codec went with them. `wire-shared.ts` used to
  carry both `schema` (read by engines up to 0.1.6) and
  `create: () => TypertSchema` (read by 0.1.7) so one descriptor could serve
  either engine; with 0.1.7 the only generation still in range, the legacy
  member and the explanation that propped it up are deleted.
- The new `developer/message` events (tool-registry changes) stay out of the
  review state: they are session bookkeeping, never authorization, and a
  0.1.6 session had no equivalent — so what Jev receives is unchanged.

- The host half no longer filters `tool-result` blocks out of user messages:
  0.1.7 gave tool results their own message role, so those blocks no longer
  appear in a user message's content and the two filters were type errors
  against the narrowed `ContentBlock` union.
- `tests/settings.test.ts` pins the new save contract: a write the Host refused
  fails the save and keeps the draft, an accepted one clears it, and a draft
  whose trimmed text already matches the stored value is never written.

## 0.2.6

- **Fix: the reprieve path could replace a clean denial with a raw service
  error.** The seam accessor used `ctx.userQuestions`, which Cordis guards
  behind an inject — outside an injected scope that property access throws
  `cannot get property "userQuestions" without inject`. With `askOnDeny` on
  (the default), every denied call hit that throw instead of the question card
  or the self-explaining denial, so denied commands (an install, a push) died
  with an internal error and no output — which reads as "the install did
  nothing". The accessor now uses the supported soft lookup
  (`ctx.get('userQuestions')`, yielding `undefined` when the service is
  absent), and the ask is wrapped so it can never escape or reject: every
  failure — a guarded accessor, a missing service, a malformed answer payload —
  degrades to the fail-closed denial with the reason in its suffix.
- Two regression tests pin the property: the asker resolves an error result
  (never rejects) when the seam accessor throws or the answerer returns a
  malformed payload. 72 tests total.

## 0.2.5

- **A denial now asks the human before it becomes final.** On any denial — a
  risk verdict (`risk: …`) or a failure of the review itself
  (`review_error: …`) — the plugin asks through DSH's user-questions seam
  (`ctx.userQuestions`, the seam behind the model's `ask_user_question` tool),
  shows the original denial text verbatim, and offers
  **允许本次执行 (Allow once)** / **保持拒绝 (Keep denied)**. An allow lifts the
  denial for that one call only and is never remembered; every other outcome
  (no answerer mounted, a subagent's call, an aborted call, an unrecognised
  answer) keeps the denial, and the denial suffix records which of those it was.
- New `src/ask-on-deny.ts` and `tests/ask-on-deny.test.ts` (17 assertions,
  covering the question copy, the answer vocabulary, per-session prompt
  serialization, and every fail-closed path).
- New `Config.askOnDeny` (default `true`); set it to `false` for a reviewer that
  never asks.
- Why not the platform's own `{ kind: 'ask' }` decision: it routes through
  `ctx.approval`, whose `decide()` answers `'rejected'` immediately while the
  session policy is `never` — exactly the policy the Auto preset pairs with
  Full access. The reprieve therefore asks the user-questions seam directly.
  The deviation is deliberate and narrow: the human may override a denial, the
  model never may.

## 0.2.4

- **The usage panel moved into the settings page.** It now renders inline at the
  top of the "Auto Review Jev" page, directly above the API key: account
  snapshot, quota bars, this host's counters, a manual refresh and an "Updated"
  timestamp. Its copy follows the UI language — bound to the `panel.jev`
  namespace through a new `panelText` seat, because a `settings.section` entry
  declares only one locale namespace.
- **The settings page is called `Auto Review Jev` in every locale.** The page
  name is a product name and is deliberately untranslated: the English and
  Chinese copy dictionaries carry the same literal for `nav` and `title`.
- **The sidebar quota card is gone.** Removed along with it: the
  `sidebar.footer.action` registration, the keyed `main` dashboard cell,
  `JevFooterEntry`, the quota ring, the open/close plumbing, the card-only CSS
  and copy, and the slot-map module that declared those two slots. The plugin
  now mounts a single `settings.section` surface, so the sidebar, the composer
  and the layout service are no longer touched.
- The card-only `headline` projection was dropped from the panel view model;
  the two tests that asserted it now assert the same facts through `creditBar`.

## 0.2.3

- **Denial reasons are visible.** A fail-closed denial (unreachable endpoint,
  invalid key) and a genuine risk verdict used to look identical in the UI,
  because the reason only lived in a structured field: an HTTP 401 surfaced as a
  wall of unexplained denials. The detail is now appended to the copy DSH
  renders — `Jev Auto review rejected tool "bash"; its body was not executed —
  review_error: HTTP 401 (missing or invalid API key)` — with the key still
  redacted.
- New `src/denial.ts` (`rejectionReason()` / `denial()`) and
  `tests/denial.test.ts` (6 assertions, including a 401 regression guard).
  Behaviour and public API are unchanged (`lib/index.d.ts` still 15630 bytes).

## 0.2.2

- Keep the settings locale namespace slash-free, and single-source the constants
  shared by the host and browser halves.

## 0.2.1

- Renamed the package to `@dsh-external/dsh-auto-review-jev` (the previous
  unscoped name is no longer used; existing configs must be updated).

## 0.2.0

- Account usage reporting (`jev/report` Remote, host-side accumulator and the
  optional account-quota poll), the API-key settings UI, and coexistence with
  the official auto review through a dedicated `preset: auto-jev`.

## 0.1.0

- First standalone release: Jev-backed per-tool-call authorization review for
  DSH's Auto permission preset.
