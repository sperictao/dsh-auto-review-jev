#!/usr/bin/env bash
#
# Release one version: verify, build, pack, commit, tag, push, publish.
#
# The repository's release convention, as established by v0.2.0 … v0.2.6:
# a commit named after the version, an ANNOTATED tag `v<version>`, and a
# GitHub Release whose notes are the matching CHANGELOG section and whose
# asset is the prebuilt tarball.
#
# Usage:  bash scripts/release.sh
#
# The version comes from package.json — bump it and add the CHANGELOG entry
# BEFORE running this.

set -euo pipefail

cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
tag="v${version}"
tarball="dsh-external-dsh-auto-review-jev-${version}.tgz"

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "release: tag ${tag} already exists" >&2
  exit 1
fi

# The gates CI runs. A release is the one artifact that cannot be corrected
# after the fact, so nothing here is skippable.
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test

# Build explicitly, then pack: `pnpm pack` re-runs `prepare` (tsdown), but the
# explicit build makes the tarball's provenance obvious and catches a broken
# build before the pack step buries it.
pnpm build
pnpm pack

test -f "${tarball}" || { echo "release: ${tarball} was not produced" >&2; exit 1; }

git add -A
git commit -m "${version}"
git tag -a "${tag}" -m "${version}"
git push --follow-tags origin main

# Release notes are the CHANGELOG section for this version, so the release
# page can never drift from the file.
notes=$(awk -v heading="## ${version}" '$0 == heading { found = 1; next } found && /^## / { exit } found' CHANGELOG.md)
if [ -z "${notes}" ]; then
  echo "release: CHANGELOG.md has no '## ${version}' section" >&2
  exit 1
fi

gh release create "${tag}" "${tarball}" --title "${tag}" --notes "${notes}"

echo "release: ${tag} published with ${tarball}"
