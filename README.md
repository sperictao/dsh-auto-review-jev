# @dsh-external/dsh-auto-review-jev

**English** | [中文](README.zh-CN.md)

`@dsh-external/dsh-auto-review-jev` gives DeepSeek Harness's **Auto** permission preset a per-tool-call authorization review powered by [TypeSafe Jev](https://docs.typesafe.ai).

Design references:

- DeepSeek Harness `packages/experimental/auto-review`: the Auto preset, the `tools/pre-execute` review point, PTC inner-call coverage, the permission lifecycle and fail-closed semantics.
- `y0usaf/pi-jev`: Jev typed questions, calibrated thresholds, argument trimming and a short-lived verdict cache.

The main difference from the upstream Auto review: this plugin does **not** ask the reviewer for free-text `risk/decision` JSON. Jev returns several independent `noul` / `score` numbers and the plugin combines them locally with fixed rules into a final `allow` / `deny`.

Changes per release are listed in [CHANGELOG.md](CHANGELOG.md).

## Behavior

When the current session selects `Auto`, every supported native tool call and every started PTC inner call passes through Jev before its body executes.

- Low risk: ordinary in-project reads and writes, analysis, formatting, tests, builds — allowed.
- Medium risk: breaking existing state, production effects, external writes, permission/security-control changes, high-impact operations. Allowed only when the current human/direct-parent instruction explicitly authorizes the action, its target and the necessary scope, with no conflict or overreach.
- High risk: leaking sensitive data across a trust boundary — always denied.
- Jev timeout, throttling that survives the retries, malformed responses, or a context/schema that cannot be rebuilt reliably: **deny (fail closed)**.
- Denials carry their reason: a risk verdict shows `risk: …`, a failure of the review itself shows `review_error: …` (for example `review_error: HTTP 401 (missing or invalid API key)`). The reason lands in both the visible copy and the structured `info.reason`, so a wall of denials caused by a bad key can no longer be misread as a risk decision.

The outer `run_code` is PTC transport and is not reviewed on its own; each of its PTC inner tool calls is reviewed separately. As with upstream Auto review, direct Node.js side effects inside a `run_code` program that bypass the DSH tool registry are outside this plugin's review scope.

## Installation

`@dsh-external` is not a publishable scope on npm, so the package is installed into a web profile from a release tarball or from a source checkout:

```bash
# from the tarball attached to any release (no build step, no pnpm allowlist needed)
dsh plugin --profile web add ./dsh-external-dsh-auto-review-jev-<version>.tgz

# or straight from a source checkout (development)
dsh plugin --profile web add /path/to/dsh-auto-review-jev
```

Configure the TypeSafe API key:

```bash
export TYPESAFE_API_KEY="..."
```

You can also paste it into DSH Web's **Settings → Auto Review Jev** page (it is written through the credentials domain and never echoed back).

Then pick the preset in the permission selector: `Auto` by default, or the dedicated preset name when you bind the reviewer to its own preset (see [Coexisting with DSH's built-in auto review](#coexisting-with-dshs-built-in-auto-review)).

Without `TYPESAFE_API_KEY` the plugin still loads, but it will not let you switch to that preset; if a session is already running under the preset while the key is invalid, its tool calls fail closed.

`Auto` is DSH's single fixed integration point — do not load the official `@deepseek-ai/dsh-experimental-auto-review` together with this plugin (the official one evicts this one and leaves it INACTIVE). `permissionPresets.registerAuto()` admits exactly one Auto reviewer.

If you need both installed **at the same time**, bind this plugin to its own preset name (`preset: auto-jev`, displayed as "Auto Reviewer Jev") — see the coexistence section below.

### Installing from GitHub: pnpm blocks the build script (allowBuilds)

```bash
dsh plugin --profile web add github:sperictao/dsh-auto-review-jev
```

On pnpm ≥ 10 that command fails:

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from
"https://codeload.github.com/sperictao/dsh-auto-review-jev/tar.gz/<sha>": The git-hosted
package "@dsh-external/dsh-auto-review-jev@0.2.4" needs to execute build scripts but is
not in the "allowBuilds" allowlist.
```

The cause is not anything unusual in this package: **build output is not committed, and pnpm does not trust dependency lifecycle scripts by default**. The package uses `prepare` (`tsdown`) to produce `lib/`, and `lib/` is git-ignored, so a git-sourced install has to build once on the spot. pnpm's supply-chain defence refuses third-party lifecycle scripts by default — registry sources report `Ignored build scripts: …` (`strictDepBuilds` defaults to true), git sources fail outright.

Three ways out, in order of preference:

**1. Install the prebuilt tarball (recommended, no allowlisting at all)**

```bash
dsh plugin --profile web add ./dsh-external-dsh-auto-review-jev-<version>.tgz
```

The tarball already contains a built `lib/`, so the install never runs `prepare` and never trips the block.

**2. Install through the DSH Pro Max launcher (one-click approval)**

Enter `github:sperictao/dsh-auto-review-jev` (the `owner/repo` form works too) under **Custom install** on the marketplace page. When pnpm blocks it, the launcher raises an **Allow build scripts?** dialog listing the exact keys that need approving; **Approve & install** writes those keys into the profile's `pnpm-workspace.yaml` and reruns the install for you — no manual file editing. Since DSH Pro Max v0.8.26 both key shapes are recognised: `name@git+https://…#<sha>` and `name@https://codeload.github.com/…/tar.gz/<sha>`.

**3. Allowlist it by hand**

Copy the keys printed in pnpm's `allowBuilds:` example block **verbatim** into the profile's `pnpm-workspace.yaml`:

- macOS / Linux: `~/.dsh/profiles/web/pnpm-workspace.yaml`
- Windows: `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`

```yaml
allowBuilds:
  # a key starting with @ MUST be quoted: @ is a YAML reserved character and a
  # bare key breaks the whole profile config
  '@dsh-external/dsh-auto-review-jev@git+https://github.com/sperictao/dsh-auto-review-jev.git#<sha>': true
# pnpm 10 uses this list key; pnpm 11 and later use allowBuilds above, where the old key no longer applies
onlyBuiltDependencies:
  - '@dsh-external/dsh-auto-review-jev'
```

Then rerun the install. Running `pnpm approve-builds` inside that profile directory also works — it writes the approved package into the same `allowBuilds`; if the interaction does not finish, the key may be left as a placeholder (`set this to true or false`) that you have to change to `true` (the launcher's approval flow overwrites the placeholder automatically).

Three things worth knowing:

- **The key pnpm prints is pinned to a commit**: it points at the concrete source resolved this time (`#<sha>`, or `/tar.gz/<sha>` when fetched through codeload). Once the repository has a new commit, the next install prints a new key and needs another approval.
- **To approve once and stay approved**, write the **repository-shaped** key by hand (no `#<sha>`): `'@dsh-external/dsh-auto-review-jev@git+https://github.com/sperictao/dsh-auto-review-jev.git': true`. On pnpm ≥ 11.19.0 it covers both fetch paths (clone and codeload tarball), so later commits need no re-approval.
- **Approval is profile-scoped**: an entry applies to every install in that profile and deleting it restores the block.

## Coexisting with DSH's built-in auto review

DSH's `auto` preset admits **exactly one** integration: a second plugin calling `permissionPresets.registerAuto()` throws `preset "auto" is already registered`. To avoid fighting the official auto review for the same slot, this plugin can bind its reviewer to **its own preset name**:

```yaml
- id: permission
  config:
    presets:
      # note: an id-targeted override replaces the WHOLE config row, so every
      # shipped preset has to be restated
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
      auto-jev:
        sandbox: danger-full-access
        approval: never
        name: Auto Reviewer Jev
        description: TypeSafe Jev per-tool-call authorization review (replaces manual confirmation)

- id: auto-review-jev
  config:
    preset: auto-jev
```

`auto-jev` carries the same sandbox/approval pair as the built-in `auto` (`danger-full-access` + `never`) — the reviewer itself takes the place of manual confirmation.

Behavior guarantees:

- `preset: auto` (default): occupies DSH's fixed Auto slot. If another integration already owns that slot, this plugin does **not** fail to load; it steps aside (pure pass-through, no verdicts) and logs a warning that names the fix — two reviewers can never judge the same preset.
- `preset: <other name>`: never touches the Auto slot and coexists with the official auto review; with an undeclared preset it again only warns instead of crashing.

## Account usage and the settings page

In the DSH Web UI this plugin mounts **one** surface (following the pattern of `Mars-Sea/dsh-commandcode-provider`):

- **Settings page**: the "Auto Review Jev" section in the Settings navigation (`settings.section`; the page name keeps that English spelling in every UI language, deliberately untranslated). Top to bottom: usage panel → API key (a `TYPESAFE_API_KEY` reference in the credentials domain; the key is never echoed back) → evaluation endpoint → usage endpoint → model.
- **Usage panel**, rendered inline at the top of the settings page, directly above the API key: the account snapshot (avatar, plan, quota bars, balance, reset time) and this host's counters in full, with a manual refresh and an "Updated" timestamp. Its copy follows the UI language.

> 0.2.4 removed the sidebar quota card and the center-column dashboard: usage is presented inline on the settings page, and the sidebar, the composer and the layout service are no longer touched by this plugin.

Usage data comes in two layers:

1. **Local counters** (always available): the host accumulates the number of review calls, the allow/deny/failure tallies and the `usage.input_tokens` / `usage.output_tokens` from every response. Counters are in-memory, reset when the host restarts, and say so in the UI.
2. **Account quota** (optional): TypeSafe's public API has no official quota endpoint, so the plugin supports a configurable `usageEndpoint`. Once set, the host polls it with the same Bearer key (every 300 seconds by default) and decodes the body permissively: fields are probed under common aliases (`balance`/`limit`/`used`/`remaining`/`token_used`/`resets_at`, snake_case and camelCase alike), one level of envelope (`data`/`account`/`usage`/`quota`) is unwrapped, and missing fields are simply not shown.

The browser never holds the API key: every fact is served host-side over the `jev/report` Typert Remote.

Key resolution order (re-resolved on every review, so edits need no restart):

1. The credentials-domain `TYPESAFE_API_KEY` reference — where the settings page stores the key; an exported environment variable of the same name is also picked up through the credentials domain's environment layer (a read-only source shadows a stored record).
2. The plugin config's `apiKey` field (a deployment-level fallback).

```yaml
- id: auto-review-jev
  name: '@dsh-external/dsh-auto-review-jev'
  config:
    # account-quota endpoint (optional; empty = the panel shows local counters only)
    usageEndpoint: https://api.typesafe.ai/v1/usage
    # background poll interval in seconds (minimum 30)
    usageRefreshSeconds: 300
```

## Default review dimensions

| Dimension | Type | Default threshold | Handling |
|---|---|---:|---|
| sensitive_exfiltration | noul | 0.70 | high risk, always denied |
| destructive | noul | 0.90 | medium risk; exempted by exact same-session cleanup |
| production_effect | noul | 0.80 | medium risk |
| external_write | noul | 0.80 | medium risk |
| security_change | noul | 0.80 | medium risk |
| beyond_scope | noul | 0.85 | denied outright |
| explicit_authorization | noul | 0.85 | required for a medium-risk allow |
| authorization_conflict | noul | 0.50 | at threshold, medium risk is denied |
| session_created_cleanup | noul | 0.80 | only offsets the destructive classification |
| impact | score 0-3 | 2.50 | medium risk, minimum confidence 0.50 |

`destructive=0.90` and `beyond_scope=0.85` follow `pi-jev`'s measured experience: ordinary, explicitly requested edits can score surprisingly high on destructive/beyond-scope, so those thresholds cannot simply be set to 0.5 or 0.7.

## Configuration

Cordis config can override the following fields; usually you only need `TYPESAFE_API_KEY`:

```yaml
- id: auto-review-jev
  name: '@dsh-external/dsh-auto-review-jev'
  config:
    model: jev-latest
    endpoint: https://api.typesafe.ai/v1/systemone
    timeoutMs: 20000
    retries: 2
    maxStateChars: 12000
    argumentChars: 600
    cacheSeconds: 120
```

Risk thresholds can also be overridden through same-named `*Threshold` config keys. Keep the defaults until you have built and calibrated your own labelled set.

## What Jev receives

Each review sends at most:

- the current working directory and platform;
- the currently visible project instructions (marked as constraints);
- human/direct-parent instructions, checkpoint/fact entries and historical tool-call facts from the visible history;
- the name, description and argument schema of the tool about to run;
- the arguments themselves, with long strings truncated to `argumentChars`;
- fixed authority-source metadata stating that only a human/direct-parent can authorize a medium-risk action.

Assistant prose and reasoning are never sent, and historical tool results are never used as authorization evidence. When the whole state exceeds `maxStateChars`, the oldest history is dropped first, then the project instructions are trimmed further.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The build emits two bundles: `lib/index.js` (host side, ESM) and `lib/client.js` (browser side, CJS loaded through `window.__ModuleLoader__`). The package declares `cordis.patch.yml` via `dsh.bundle.patch` and its browser entry via `dsh.client` + `exports["./client"]`, so it installs as a standalone DSH plugin.

## Security boundary

Auto review is a risk-reduction layer, not an isolation sandbox. Allowed calls still execute with the Full access the Auto preset grants. If you need hard isolation, use DSH's own sandbox / deployment boundary as well instead of relying on a classifier in place of isolation.

## License

MIT. See [NOTICE.md](NOTICE.md) for the reference implementations and attribution.
