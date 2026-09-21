import { describe, expect, it } from 'vitest'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { denial, rejectionReason } from '../src/denial.ts'

/** Narrow the union so the deny-only fields are reachable without assertions. */
function denyOf(decision: PreToolDecision): Extract<PreToolDecision, { kind: 'deny' }> {
  if (decision.kind !== 'deny') throw new Error(`expected a deny decision, got ${decision.kind}`)
  return decision
}

const bash = { name: 'bash' } as unknown as ToolExecution

describe('rejectionReason', () => {
  it('names the tool and states that the body never ran', () => {
    expect(rejectionReason('bash')).toBe('Jev Auto review rejected tool "bash"; its body was not executed')
  })

  it('appends the detail to the copy the user actually reads', () => {
    // Regression guard: a 401 from the Jev endpoint used to live only in the
    // structured info, so a broken integration looked exactly like a risk
    // judgment and every denial was unexplainable from the transcript.
    expect(rejectionReason('bash', 'review_error: HTTP 401 (missing or invalid API key)'))
      .toBe('Jev Auto review rejected tool "bash"; its body was not executed — review_error: HTTP 401 (missing or invalid API key)')
  })
})

describe('denial', () => {
  it('denies with the structured code DSH records', () => {
    const decision = denyOf(denial(bash))
    expect(decision.reason).toBe('Jev Auto review rejected tool "bash"; its body was not executed')
    expect(decision.info?.name).toBe('JevAutoReviewDeniedError')
    expect(decision.info?.code).toBe('JEV_AUTO_REVIEW_DENIED')
  })

  it('omits the structured reason entirely when there is no detail', () => {
    // An empty `info.reason` would read as "denied for no reason" downstream.
    expect(denyOf(denial(bash)).info?.reason).toBeUndefined()
  })

  it('carries a reviewer failure in both the copy and the structured info', () => {
    const decision = denyOf(denial(bash, 'review_error: HTTP 401 (missing or invalid API key)'))
    expect(decision.reason).toContain('review_error: HTTP 401 (missing or invalid API key)')
    expect(decision.info?.reason).toBe('review_error: HTTP 401 (missing or invalid API key)')
  })

  it('carries a risk summary the same way', () => {
    const decision = denyOf(denial(bash, 'high: sensitive data crossing a trust boundary'))
    expect(decision.reason).toContain('high: sensitive data crossing a trust boundary')
    expect(decision.info?.reason).toBe('high: sensitive data crossing a trust boundary')
  })
})
