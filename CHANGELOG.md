# Changelog

Notable changes to `@dsh-external/dsh-auto-review-jev`. Each version matches a
[git tag](https://github.com/sperictao/dsh-auto-review-jev/tags) and a GitHub
Release carrying a prebuilt tarball.

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
