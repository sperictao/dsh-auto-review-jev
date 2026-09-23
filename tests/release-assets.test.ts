import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Release-asset consistency.
 *
 * scripts/release.sh packs, tags and publishes; CI runs the build and the test
 * suite. Neither checks that the version, the changelog and the published file
 * list agree with each other — and release.sh only discovers a missing
 * changelog section AFTER the commit, tag and push, which is the one artifact
 * that cannot be corrected afterwards. These assertions run in the same
 * `pnpm test` step both of them already execute.
 */

const root = new URL('../', import.meta.url)
const read = (name: string): string => readFileSync(new URL(name, root), 'utf8')

interface PackageJson {
  name: string
  version: string
  files?: string[]
}

const pkg = JSON.parse(read('package.json')) as PackageJson
const changelog = read('CHANGELOG.md')

/** The `## <version>` headings, in file order (the H1 is not a version). */
function changelogVersions(text: string): string[] {
  const versions: string[] = []
  for (const line of text.split('\n')) {
    const match = /^## +(\S+)\s*$/.exec(line)
    if (match?.[1] !== undefined) versions.push(match[1])
  }
  return versions
}

/** A `files[]` entry as a pattern: regex metacharacters literal, `*` a wildcard. */
function fileEntryPattern(entry: string): RegExp {
  return new RegExp(`^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
}

describe('release assets', () => {
  it('documents the shipping version, newest section first', () => {
    const versions = changelogVersions(changelog)

    expect(versions).toContain(pkg.version)
    expect(
      versions[0],
      `CHANGELOG.md's newest section is ${versions[0]}, but package.json says ${pkg.version}`,
    ).toBe(pkg.version)
  })

  it('parses version sections and nothing else', () => {
    expect(changelogVersions('# Changelog\n\n## 0.2.7\n\n## 0.2.6\n')).toEqual(['0.2.7', '0.2.6'])
    expect(changelogVersions('# Changelog\n\nA mention of 0.2.7 in prose.\n')).toEqual([])
    expect(changelogVersions('## 0.2.7  \n')).toEqual(['0.2.7'])
    expect(changelogVersions('# Changelog\n\n### 0.2.7\n')).toEqual([])
  })

  it('publishes only files that exist', () => {
    const entries = pkg.files ?? []
    expect(entries.length).toBeGreaterThan(0)
    const present = readdirSync(root)

    for (const entry of entries) {
      // `lib` is build output (gitignored); CI's bundle check covers it.
      if (entry === 'lib') continue
      if (entry.includes('*')) {
        const pattern = fileEntryPattern(entry)
        expect(
          present.some(name => pattern.test(name)),
          `package.json publishes "${entry}" but nothing in the repository matches it`,
        ).toBe(true)
        continue
      }
      expect(existsSync(new URL(entry, root)), `package.json publishes "${entry}", which does not exist`).toBe(true)
    }
  })

  it('mounts this package from the profile patch', () => {
    const patch = read('cordis.patch.yml')
    // A rename that misses the patch breaks every profile that installs the
    // plugin, and nothing else notices.
    expect(patch).toContain(`'${pkg.name}'`)
  })
})
