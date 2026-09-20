import { describe, expect, it } from 'vitest'
import { API_KEY_REF, JEV_SETTINGS_NS } from '../src/wire-shared.ts'

/**
 * dsh-settings rejects any namespace outside /^[a-z][a-z0-9-]*$/ at
 * `settings.register` — a rejected registration leaves the namespace absent
 * from the describe view, which disables every control on the settings page.
 * Lock the shape so a package rename can never drag the namespace along
 * again.
 */
const DSH_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

describe('cross-boundary constants', () => {
  it('keeps the settings namespace acceptable to dsh-settings', () => {
    expect(JEV_SETTINGS_NS).toMatch(DSH_NAMESPACE_PATTERN)
  })

  it('keeps the credential reference stable', () => {
    expect(API_KEY_REF).toBe('TYPESAFE_API_KEY')
  })
})
