/**
 * Preset binding for the Jev reviewer.
 *
 * DSH's `auto` preset admits exactly ONE integration — a second
 * `registerAuto()` caller throws `permission: preset "auto" is already
 * registered`. Two failure modes must both be avoided when that happens:
 *
 * - **A boot crash.** An uncaught throw here fails the whole plugin tree, so a
 *   user who installs this next to DSH's built-in auto review loses their
 *   entire profile rather than one plugin.
 * - **A silent double review.** If this plugin stayed engaged on `auto` while
 *   another integration owned the slot, BOTH reviewers would decide every
 *   call. This plugin prepends its listener, so it would win the race and the
 *   other integration would be dead weight — confusing at best.
 *
 * So a conflict DISENGAGES this plugin (pure pass-through, never a decision)
 * and returns one warning naming the fix. Binding to a distinct preset name
 * avoids the contention entirely, which is the recommended arrangement.
 *
 * @module dsh-auto-review-jev/preset-binding
 */

import { AUTO_PRESET } from '@deepseek-ai/dsh-permission-presets'

/** The permission-preset face this module needs. */
export interface PresetBinder {
  /** Every currently switchable preset name. */
  readonly names: readonly string[]
  /** Claim the fixed `auto` slot; throws when another integration owns it. */
  registerAuto(admit: () => void): () => Promise<void>
}

/** The outcome of one binding attempt. */
export interface PresetBinding {
  /**
   * Whether the reviewer decides calls for this preset. False means the event
   * listener must be pure pass-through.
   */
  engaged: boolean
  /** Operator-facing warning; '' when the binding is healthy. */
  warning: string
  /** Disposer withdrawing a claimed `auto` slot; undefined for a named preset. */
  release: (() => Promise<void>) | undefined
}

/**
 * Bind the reviewer to `presetName`.
 *
 * A NAMED preset stays engaged even when it is not currently configured: the
 * gate compares against the live preset of each session, so an absent name
 * simply never matches, and the plugin then starts working the moment a live
 * patch adds the preset — no restart needed. The warning still tells the
 * operator that nothing will happen until they declare it.
 *
 * @param presetName - the preset this reviewer binds to.
 * @param presets - the permission-preset service.
 * @param admit - synchronous gate DSH runs before a live Auto selection.
 */
export function bindReviewerPreset(
  presetName: string,
  presets: PresetBinder,
  admit: () => void,
): PresetBinding {
  if (presetName === AUTO_PRESET) {
    try {
      return { engaged: true, warning: '', release: presets.registerAuto(admit) }
    } catch (error: unknown) {
      return {
        engaged: false,
        warning:
          `permission preset "${AUTO_PRESET}" is already owned by another integration, so the Jev reviewer is `
          + 'INACTIVE (it will not allow or deny anything). Remove the other Auto reviewer, or set this plugin\'s '
          + '`preset` option to a distinct name such as `auto-jev` and declare that preset under '
          + '`permission-presets` in your profile patch. '
          + `(${error instanceof Error ? error.message : String(error)})`,
        release: undefined,
      }
    }
  }
  if (presets.names.includes(presetName)) {
    return { engaged: true, warning: '', release: undefined }
  }
  return {
    engaged: true,
    warning:
      `permission preset "${presetName}" is not among the configured presets `
      + `[${presets.names.join(', ')}], so the Jev reviewer will not activate until it is declared. Add it under `
      + '`permission-presets.config.presets` in your profile patch (see the README for a ready-made entry).',
    release: undefined,
  }
}
