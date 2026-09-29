# Plan 004: Align the Cordis peer with the 0.1.7 dependency family

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1c758f6..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml README.md README.zh-CN.md`
> If any in-scope file changed since this plan was written, re-read the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration (dependency range)
- **Planned at**: commit `1c758f6`, 2026-09-23

## Why this matters

This plugin's 0.2.7 release adapted to DeepSeek Harness `0.1.7-alpha.1` and
narrowed every DSH peer range to `^0.1.7-alpha.1`, but left its Cordis floor at
`^4.0.2`. Every package in the `0.1.7-alpha.1` family declares
`@deepseek-ai/cordis: ^4.0.3` — including `@deepseek-ai/dsh-agent`, the host
whose APIs this plugin's entry half is compiled against. So the plugin
advertises support for a Cordis the host itself considers out of range, and the
resolved tree in this very repository already violates that floor: the lock
pins `@deepseek-ai/cordis@4.0.2` everywhere, including in the peer-suffixed
resolution of `@deepseek-ai/dsh-agent@0.1.7-alpha.1`.

A consumer installing this plugin is therefore free to resolve a combination the
harness no longer supports, and the failure would surface at load or run time
rather than at resolution time. Raising the floor is a one-line change per
place; documenting the supported matrix is what stops operators from having to
infer it from peer fields.

## Current state

- `package.json:70` (peerDependencies) and `package.json:103` (devDependencies):

  ```json
  "@deepseek-ai/cordis": "^4.0.2",
  ```

  These are the only two occurrences (`grep -c '"@deepseek-ai/cordis"' package.json` → 2).

- `node_modules/@deepseek-ai/dsh-agent/package.json` — the host package, same
  version this plugin peers on — declares the floor in both its `dependencies`
  (line 49) and `peerDependencies` (line 67):

  ```json
  "@deepseek-ai/cordis": "^4.0.3"
  ```

- Installed and locked today: `@deepseek-ai/cordis@4.0.2`
  (`node -p "require('./node_modules/@deepseek-ai/cordis/package.json').version"`),
  and `pnpm-lock.yaml:22` onwards resolves
  `0.1.7-alpha.1(@deepseek-ai/cordis@4.0.2)` for the DSH packages — the
  peer-suffixed resolution is the record of the mismatch.

- `pnpm-workspace.yaml:1-40` — the install policy, which already carries an
  exclusion list for the `0.1.7-alpha.1` upgrade:

  ```yaml
  allowBuilds:
    esbuild: true
  minimumReleaseAgeExclude:
    - '@deepseek-ai/cosmokit@1.8.4'
    - '@deepseek-ai/dsh-agent-instructions@0.1.7-alpha.1'
    …
    - '@deepseek-ai/schemastery@3.18.3'
  ```

  A newer Cordis may be blocked by the same release-age policy that list exists
  to bypass; see Step 3.

- `README.md` and `README.zh-CN.md` document configuration, coexistence and the
  build, but state no supported DSH/Cordis range anywhere (verified:
  `grep -n "0\.1\.7" README.md` → no matches).

- `tsdown.config.ts` lists `@deepseek-ai/cordis` in `deps.neverBundle` for both
  the host and the browser build, so this change cannot alter the bundles'
  externals.

Conventions to follow:

- Dependency ranges in this repo are caret ranges on the exact line the family
  ships (`^0.1.7-alpha.1`), with a comment in `CHANGELOG.md` explaining each
  narrowing. Read `CHANGELOG.md`'s `## 0.2.7` section before you start: it
  records the decision that produced the current ranges.
- Both READMEs are maintained in parallel; a change to one is a change to both.

## Commands you will need

| Purpose            | Command                                                                 | Expected on success          |
|--------------------|-------------------------------------------------------------------------|------------------------------|
| Install            | `pnpm install`                                                          | exit 0                       |
| Reproducible install | `pnpm install --frozen-lockfile`                                      | exit 0 (what CI runs)        |
| Typecheck          | `pnpm typecheck`                                                        | exit 0                       |
| Tests              | `pnpm test`                                                             | exit 0 (75 tests)            |
| Build              | `pnpm build`                                                            | exit 0                       |
| Resolved version   | `node -p "require('./node_modules/@deepseek-ai/cordis/package.json').version"` | `4.0.3` or higher     |

## Scope

**In scope** (the only files you should modify):
- `package.json`
- `pnpm-lock.yaml` (regenerated by `pnpm install` — never hand-edited)
- `pnpm-workspace.yaml` (only if Step 3 requires an exclusion entry)
- `README.md`, `README.zh-CN.md` (the compatibility section)

**Out of scope** (do NOT touch, even though they look related):
- Any other dependency range. Do not "tidy" ranges, do not upgrade the DSH
  package family, do not add or remove devDependencies. This plan changes one
  floor and documents it.
- `src/**` — a type error after the bump is a STOP condition, not a refactor
  invitation.
- `CHANGELOG.md` and the version number — see the maintenance note about the
  patch release this change needs; the release flow owns it.

## Git workflow

- Branch: `advisor/004-align-dependency-family`
- Commit style matches `git log`, e.g.
  `chore: raise the Cordis floor to the 0.1.7 dependency family's ^4.0.3`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Raise the floor

Change both occurrences in `package.json` to `"^4.0.3"` — the peer range and the
dev range must stay identical (a peer range looser than the version the plugin
is developed and tested against is how this drift started).

**Verify**: `grep -c '"@deepseek-ai/cordis": "\^4.0.3"' package.json` → `2`.

### Step 2: Re-resolve

Run `pnpm install` (needs the registry).

**Verify**:
- `node -p "require('./node_modules/@deepseek-ai/cordis/package.json').version"`
  → `4.0.3` or higher.
- `grep -n "cordis@" pnpm-lock.yaml | head -3` → the peer-suffixed resolutions
  now name the same `4.0.3+` version (no `@deepseek-ai/cordis@4.0.2` remnants:
  `grep -c "cordis@4.0.2" pnpm-lock.yaml` → `0`).

### Step 3: If the install is refused by the release-age policy

If pnpm refuses the newer Cordis because it is too fresh, add its exact version
to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, matching the existing
entries' format (`'@deepseek-ai/cordis@<resolved version>'`), then re-run
`pnpm install`. Keep the list's existing ordering style (it is alphabetical
among the DSH packages; put the Cordis entry where it sorts).

Do not add a `minimumReleaseAge` setting itself and do not disable the policy
globally.

**Verify**: `pnpm install --frozen-lockfile` → exit 0 (this is what CI runs).

### Step 4: Run the gates

`pnpm typecheck && pnpm test && pnpm build`, each must exit 0. Cordis is an
external in both tsdown configs, so the bundles' contents should be unchanged in
kind — but the build must still pass.

**Verify**: all three commands exit 0. If `pnpm typecheck` fails, see STOP
conditions.

### Step 5: Document the supported matrix

Add a short "Compatibility" / "兼容性" section to `README.md` and
`README.zh-CN.md` (same content, each in its own language), near the installation
section. Cover exactly four facts, in this order:

1. The plugin supports DeepSeek Harness `0.1.7-alpha.1` — its peer ranges admit
   nothing older, and the browser half needs the settings `configForms` service
   that only 0.1.7 provides.
2. It requires `@deepseek-ai/cordis` `^4.0.3`.
3. Older harness versions are not supported: an older Host refuses to load the
   client bundle, and the host half no longer recognises a 0.1.6 compaction
   checkpoint source.
4. Where to look if it does not load (the plugin's own warning names the fix for
   a preset conflict; a missing `configForms` shows as a disabled settings page).

Do not invent a support policy beyond these; do not add a matrix table.

**Verify**: `grep -c "0.1.7-alpha.1" README.md README.zh-CN.md` → each file
reports at least 1, and `grep -c "4.0.3" README.md README.zh-CN.md` → each file
reports at least 1.

## Test plan

No new tests: the change is a dependency range plus prose, and the behavior under
test is resolution, not code. The verification is:

- the resolved-version and lock checks in Steps 2-3 (machine-checkable, above),
- the existing gates (`pnpm typecheck`, `pnpm test`, `pnpm build`) — a
  dependency-API mismatch shows up as a type error or a failing test,
- `pnpm install --frozen-lockfile` exiting 0, which is the exact command CI runs
  and proves the lock and `package.json` agree.

If you want a durable guard, the cheapest honest one is a one-line addition to
the release-consistency test that `plans/005-release-asset-consistency-gate.md`
creates: assert the installed Cordis major.minor is at least the floor declared
in `package.json`. Only do that if plan 005 has already landed; do not create a
second test file for it.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c '"@deepseek-ai/cordis": "\^4.0.3"' package.json` → `2`
- [ ] `node -p "require('./node_modules/@deepseek-ai/cordis/package.json').version"`
      → `4.0.3` or higher
- [ ] `grep -c "cordis@4.0.2" pnpm-lock.yaml` → `0`
- [ ] `pnpm install --frozen-lockfile` exits 0
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` all exit 0
- [ ] `README.md` and `README.zh-CN.md` both state the harness version and the
      Cordis floor
- [ ] `git status --short` lists only `package.json`, `pnpm-lock.yaml`,
      `README.md`, `README.zh-CN.md` (plus `pnpm-workspace.yaml` if Step 3
      applied)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The registry has no `@deepseek-ai/cordis` at or above `4.0.3` — then the
  plugin and its host cannot agree on a version, which is a release-blocking
  finding to report, not something to work around by loosening the peer range
  again.
- `pnpm typecheck` or `pnpm test` fails after the bump: that means the plugin
  uses a Cordis API that changed between 4.0.2 and 4.0.3. Report the exact
  errors; do not add casts, `@ts-expect-error`, or a compatibility shim. This
  repository's policy is that the legacy path is deleted, not propped up.
- `pnpm install` wants to change any *other* dependency's resolved version.
  Report the diff; do not accept collateral upgrades in this plan.
- README's structure has no sensible home for the compatibility section (e.g.
  the installation section was restructured). Report where you would have put
  it.

## Maintenance notes

- **The published `0.2.7` tarball still declares `^4.0.2`.** This change is
  therefore patch-release-worthy: bump the version and add a `CHANGELOG.md`
  section describing the floor change, then run `scripts/release.sh`. Do not
  reuse the `v0.2.7` tag — the script refuses an existing tag, and re-pointing a
  published tag is worse than a new patch.
- Keep the peer and dev ranges identical. A reviewer should reject a PR that
  raises one and not the other; the asymmetry is invisible at test time and
  wrong for consumers.
- If the DSH family moves past `0.1.7-alpha.1`, the peer ranges and this
  compatibility section are the two places to update together — and
  `CHANGELOG.md`'s `## 0.2.7` section explains why the old ranges were dropped,
  so read it before widening anything.
