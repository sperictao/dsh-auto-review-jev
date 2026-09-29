# Plan 005: Gate release-asset consistency in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1c758f6..HEAD -- tests/release-assets.test.ts package.json CHANGELOG.md cordis.patch.yml`
> If `package.json`, `CHANGELOG.md` or `cordis.patch.yml` changed since this
> plan was written, re-read them before proceeding; the assertions below quote
> their current shape.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx (release gates)
- **Planned at**: commit `1c758f6`, 2026-09-23

## Why this matters

The release artifacts are checked by three separate mechanisms that do not
overlap. `scripts/release.sh` refuses an existing tag, runs
`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`, builds, packs,
commits, tags, pushes, and creates the GitHub Release — and it extracts the
release notes from `CHANGELOG.md` with an inline `awk`, failing only when the
`## <version>` section is *absent*. CI (`.github/workflows/ci.yml`) runs the
same gates plus a file-existence check for the built bundles. Nothing checks
that the version, the changelog and the published file list actually agree with
each other, and release.sh discovers a missing changelog section only *after*
the commit, tag and push have already happened — the one artifact that cannot be
corrected afterwards.

After this plan, a release whose `package.json` version has no changelog
section, or whose changelog section is not the newest one, or whose `files[]`
names something that does not exist, fails `pnpm test` — which both CI and
release.sh already run before packing.

## Current state

- `package.json:3` — the version, currently `0.2.7`; and `package.json:28-35`,
  the published file list:

  ```json
  "files": [
    "lib",
    "cordis.patch.yml",
    "README*.md",
    "CHANGELOG.md",
    "NOTICE.md"
  ],
  ```

- `CHANGELOG.md:1-8` — the version sections are `## <version>` headings, newest
  first, under a single `# Changelog` H1:

  ```markdown
  # Changelog

  Notable changes to `@dsh-external/dsh-auto-review-jev`. Each version matches a
  [git tag](https://github.com/sperictao/dsh-auto-review-jev/tags) and a GitHub
  Release carrying a prebuilt tarball.

  ## 0.2.7
  ```

- `cordis.patch.yml` — the profile patch that mounts the plugin, by package name:

  ```yaml
  - insert:
      - id: auto-review-jev
        name: '@dsh-external/dsh-auto-review-jev'
  ```

- `scripts/release.sh:49-53` — the existing (notes-extraction) changelog check,
  which must keep working:

  ```bash
  notes=$(awk -v heading="## ${version}" '$0 == heading { found = 1; next } found && /^## / { exit } found' CHANGELOG.md)
  if [ -z "${notes}" ]; then
    echo "release: CHANGELOG.md has no '## ${version}' section" >&2
    exit 1
  fi
  ```

- Test conventions: `vitest`, files under `tests/`, plain `expect` assertions.
  No test reads a file from the repository root yet; read them with
  `readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')` so the
  path does not depend on the working directory.

## Commands you will need

| Purpose   | Command                                   | Expected on success                    |
|-----------|-------------------------------------------|----------------------------------------|
| Install   | `pnpm install`                            | exit 0                                 |
| Typecheck | `pnpm typecheck`                          | exit 0                                 |
| Tests     | `pnpm test`                               | exit 0 (75 tests before this plan)     |
| One file  | `pnpm vitest run tests/release-assets.test.ts` | exit 0                            |

## Scope

**In scope** (the only file you should modify):
- `tests/release-assets.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `scripts/release.sh` — its job is to publish; the gate belongs where CI runs
  it. Do not delete its `awk` block either: it extracts the release notes, and
  the `-z` check keeps an empty release from being published.
- `.github/workflows/ci.yml` — `pnpm test` is already a CI step, so a test-based
  gate needs no workflow change. Adding a parallel shell check would duplicate
  it.
- `package.json` and `CHANGELOG.md` themselves — this plan adds no version, no
  entry and no field.

## Git workflow

- Branch: `advisor/005-release-asset-consistency-gate`
- Commit style matches `git log`, e.g.
  `test: gate release assets on version/changelog/file-list agreement`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the gate as a test

Create `tests/release-assets.test.ts`. Because the assertions read the real
repository files, split the parsing from the reading so the negative cases can
be exercised against fixture strings: a small local helper

```ts
function changelogVersions(text: string): string[]
```

returning the `## <version>` headings in file order (skip the H1 and any other
heading level; trim the heading text). Then:

**Test 1 — the version has a section, and it is the newest.**

- Assert `changelogVersions(CHANGELOG).includes(packageJson.version)`.
- Assert `changelogVersions(CHANGELOG)[0] === packageJson.version` — the newest
  section must be the shipping version. This is the check the release flow
  cannot make for itself (it only looks for *its* section).
- Failure messages must name both sides, e.g. `` `CHANGELOG.md's newest section
  is ${first}, but package.json says ${version}` ``, so the fix is obvious
  without opening the file.

**Test 2 — the parser itself** (the negative cases, on fixture strings):

- `changelogVersions('# Changelog\n\n## 0.2.7\n\n## 0.2.6\n')` →
  `['0.2.7', '0.2.6']`
- A text whose only heading is the H1 → `[]`
- A section heading with trailing spaces (`'## 0.2.7  '`) → `['0.2.7']`
- A version mentioned in prose (no `## ` prefix) is not a section.

**Test 3 — every published file exists.** Iterate `package.json` `files[]`:

- Entries without a `*` must exist (`existsSync`), except `lib`, which is build
  output (gitignored) and is verified by CI's bundle check — skip it explicitly
  with a comment saying why.
- Entries with a `*` must match at least one entry of `readdirSync(root)`. Build
  the matcher by escaping the entry's regex metacharacters and then turning `*`
  into `.*`:

  ```ts
  const pattern = new RegExp(`^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  ```

**Test 4 — the patch mounts this package.** Read `cordis.patch.yml` and assert
it contains the exact `package.json` `name` as a quoted string
(`'@dsh-external/dsh-auto-review-jev'`). A rename that misses the patch breaks
every profile that installs the plugin, and nothing else detects it.

`root` for the file reads is the repository root; derive it from
`new URL('../', import.meta.url)`.

**Verify**: `pnpm vitest run tests/release-assets.test.ts` → all pass; then
`pnpm test` → exit 0 with the 75 pre-existing tests still passing.

### Step 2: Prove the gate actually fails

The gate is only worth having if it can fail. Without editing any tracked file,
verify each branch by running the test against a deliberately wrong value — the
cheapest honest way is a throwaway assertion in the shell, for example:

```bash
node -e "const v=require('./package.json').version; const t=require('node:fs').readFileSync('CHANGELOG.md','utf8'); console.log(v, /^## /m.test(t), t.includes('## '+v))"
```

and then, for the file-list branch, temporarily move nothing — instead confirm
by reasoning plus one real negative run: change the *test's* expectation
locally (e.g. assert the newest section is `0.0.0`), watch it fail with the
message naming both sides, then revert your edit. `git diff` must be empty at
the end of this step except for `tests/release-assets.test.ts`.

**Verify**: the failure run prints a message naming the expected and actual
version, and the final `pnpm test` exits 0.

## Test plan

- New file `tests/release-assets.test.ts` with the four tests above.
- The parser test (Test 2) is what makes the real-file assertions trustworthy:
  without it, a parser that returns `[]` for everything would "pass" by
  accident on an empty changelog.
- Verification: `pnpm test` → exit 0; the gate runs in CI through the existing
  `Test` step in `.github/workflows/ci.yml`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm test` exits 0 and includes `tests/release-assets.test.ts`
- [ ] `pnpm typecheck` exits 0 (the test file is covered by `tsconfig.json`'s
      `include`)
- [ ] The deliberate negative run in Step 2 failed with a message naming the
      expected and the actual version (paste it in your report)
- [ ] `git status --short` lists only `tests/release-assets.test.ts`
- [ ] `git diff --stat 1c758f6..HEAD -- package.json CHANGELOG.md .github/ scripts/`
      is empty
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- `package.json` has no `files[]` entry, or the `files[]` contents differ from
  the excerpt (the packaging rules changed).
- `CHANGELOG.md` no longer uses `## <version>` headings, or its newest section
  is not the current version (that is a real release-consistency failure this
  gate is meant to catch — report it, do not "fix" the file).
- You need a dependency (a YAML parser, a glob library) to implement Test 3 or
  4. Both are substring/regex reads; adding a devDependency for this is out of
  scope.
- The gate fails on a file you cannot explain — report which assertion and
  which value, rather than adjusting the assertion to pass.

## Maintenance notes

- Release order matters and stays as it is: bump `package.json`, write the
  `## <version>` section **on top**, then run `bash scripts/release.sh`. The new
  test is what makes a missed step fail before anything is packed or pushed.
- The newest-section rule means a future backport release (a `0.2.8` section
  after a `0.3.0` section, say) would fail this gate. That is deliberate: this
  repo has no backport flow, and a maintained one would need the rule relaxed
  with a note here.
- If `files[]` ever gains build output other than `lib`, add it to the skip list
  with the same reasoning, or the gate will fail on a clean checkout.
