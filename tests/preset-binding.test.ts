import { describe, expect, it, vi } from 'vitest'
import { bindReviewerPreset } from '../src/preset-binding.ts'
import type { PresetBinder } from '../src/preset-binding.ts'

const noop = (): void => {}

function binder(names: readonly string[], registerAuto?: PresetBinder['registerAuto']): PresetBinder {
  return {
    names,
    registerAuto: registerAuto ?? (() => async () => {}),
  }
}

describe('bindReviewerPreset', () => {
  it('claims the fixed auto slot when it is free', () => {
    const release = async (): Promise<void> => {}
    const registerAuto = vi.fn(() => release)
    const binding = bindReviewerPreset('auto', binder(['workspace-write'], registerAuto), noop)
    expect(binding.engaged).toBe(true)
    expect(binding.warning).toBe('')
    expect(binding.release).toBe(release)
    expect(registerAuto).toHaveBeenCalledTimes(1)
  })

  it('disengages instead of crashing when another integration owns auto', () => {
    const binding = bindReviewerPreset('auto', binder(['workspace-write'], () => {
      throw new Error('permission: preset "auto" is already registered')
    }), noop)
    expect(binding.engaged).toBe(false)
    expect(binding.release).toBeUndefined()
    expect(binding.warning).toContain('already owned by another integration')
    expect(binding.warning).toContain('INACTIVE')
    // The warning must name the escape hatch, not just the problem.
    expect(binding.warning).toContain('auto-jev')
  })

  it('binds a configured named preset without touching the auto slot', () => {
    const registerAuto = vi.fn(() => async () => {})
    const binding = bindReviewerPreset('auto-jev', binder(['workspace-write', 'auto-jev'], registerAuto), noop)
    expect(binding.engaged).toBe(true)
    expect(binding.warning).toBe('')
    expect(binding.release).toBeUndefined()
    // The whole point of a named preset: DSH's built-in auto stays untouched.
    expect(registerAuto).not.toHaveBeenCalled()
  })

  it('stays engaged but warns for a named preset the profile has not declared', () => {
    const binding = bindReviewerPreset('auto-jev', binder(['workspace-write']), noop)
    // Engaged on purpose: the gate compares against each session's live preset,
    // so an absent name never matches and a live patch can add it later.
    expect(binding.engaged).toBe(true)
    expect(binding.warning).toContain('not among the configured presets')
    expect(binding.warning).toContain('auto-jev')
  })

  it('lists the configured names in the unknown-preset warning', () => {
    const binding = bindReviewerPreset('nope', binder(['read-only', 'workspace-write']), noop)
    expect(binding.warning).toContain('read-only, workspace-write')
  })

  it('passes the admit gate straight through to registerAuto', () => {
    const admit = vi.fn()
    let received: (() => void) | undefined
    bindReviewerPreset('auto', binder([], (gate) => {
      received = gate
      return async () => {}
    }), admit)
    expect(received).toBe(admit)
  })
})
