/**
 * The deny decision for one reviewed call.
 *
 * This lives in its own module for a measured reason: `PreToolDecision` and
 * `ToolExecution` come from `@deepseek-ai/dsh-tools`, and the declaration
 * bundler inlines every type reachable from the package ENTRY. Re-exporting
 * this from `index.ts` grew `lib/index.d.ts` from 15 KB to 149 KB, because the
 * whole `dsh-tools` type graph got pulled in with it. Tests import this module
 * directly, so the public surface stays what it was.
 *
 * @module @dsh-external/dsh-auto-review-jev/denial
 */

import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Error `name` DSH records for a Jev rejection. */
export const DENIED_ERROR_NAME = 'JevAutoReviewDeniedError'
/** Error `code` DSH records for a Jev rejection. */
export const DENIED_ERROR_CODE = 'JEV_AUTO_REVIEW_DENIED'

/**
 * Visible copy for one rejection.
 *
 * `detail` is appended, not hidden: a fail-closed rejection (`review_error: …`)
 * and a risk judgment (`high: …`) are otherwise indistinguishable to whoever
 * reads the transcript, so a broken API key shows up as a wall of unexplained
 * denials. `detail` is already key-redacted by the caller's `compactError()`.
 *
 * @param toolName - the reviewed tool's name.
 * @param detail - risk summary, or `review_error: …` when the reviewer failed.
 * @returns the one-line reason shown to the user.
 */
export function rejectionReason(toolName: string, detail?: string): string {
  const base = `Jev Auto review rejected tool "${toolName}"; its body was not executed`
  return detail === undefined ? base : `${base} — ${detail}`
}

/**
 * Build the deny decision for one reviewed call.
 *
 * @param exec - the tool execution being denied.
 * @param detail - risk summary, or `review_error: …` when the reviewer failed.
 * @returns the deny decision handed back to DSH.
 */
export function denial(exec: ToolExecution, detail?: string): PreToolDecision {
  return {
    kind: 'deny',
    reason: rejectionReason(exec.name, detail),
    info: {
      name: DENIED_ERROR_NAME,
      code: DENIED_ERROR_CODE,
      ...(detail === undefined ? {} : { reason: detail }),
    },
  }
}
