import { describe, expect, it } from 'vitest'
import type { JevResponse } from '../src/client.ts'
import { evaluateReview, type Thresholds } from '../src/reviewer.ts'

const thresholds: Thresholds = {
  sensitiveExfiltration: 0.7,
  destructive: 0.9,
  productionEffect: 0.8,
  externalWrite: 0.8,
  securityChange: 0.8,
  beyondScope: 0.85,
  explicitAuthorization: 0.85,
  authorizationConflict: 0.5,
  sessionCreatedCleanup: 0.8,
  impact: 2.5,
  minImpactConfidence: 0.5,
}

const ids = [
  'sensitive_exfiltration',
  'destructive',
  'session_created_cleanup',
  'production_effect',
  'external_write',
  'security_change',
  'beyond_scope',
  'explicit_authorization',
  'authorization_conflict',
] as const

function response(values: Record<string, number> = {}, impact = { score: 0, confidence: 1 }): JevResponse {
  const answers = Object.fromEntries(ids.map(id => [id, { type: 'noul' as const, noul: values[id] ?? 0 }]))
  return { model: 'jev-latest', answers: { ...answers, impact: { type: 'score', ...impact } } }
}

describe('evaluateReview', () => {
  it('allows ordinary low-risk project work', () => {
    expect(evaluateReview(response(), thresholds)).toEqual({ risk: 'low', decision: 'allow', reasons: [] })
  })

  it('hard-denies sensitive exfiltration even when authorized', () => {
    const result = evaluateReview(response({ sensitive_exfiltration: 0.95, explicit_authorization: 0.99 }), thresholds)
    expect(result.risk).toBe('high')
    expect(result.decision).toBe('deny')
  })

  it('allows explicitly authorized medium-risk work', () => {
    const result = evaluateReview(response({ production_effect: 0.92, explicit_authorization: 0.96, authorization_conflict: 0.1 }), thresholds)
    expect(result).toMatchObject({ risk: 'medium', decision: 'allow' })
  })

  it('denies medium-risk work without exact authorization', () => {
    const result = evaluateReview(response({ external_write: 0.91, explicit_authorization: 0.4 }), thresholds)
    expect(result).toMatchObject({ risk: 'medium', decision: 'deny' })
  })

  it('denies beyond-scope work even when another medium trigger is authorized', () => {
    const result = evaluateReview(response({ destructive: 0.97, beyond_scope: 0.94, explicit_authorization: 0.98 }), thresholds)
    expect(result).toMatchObject({ risk: 'medium', decision: 'deny' })
  })

  it('treats exact session-created cleanup as low risk', () => {
    const result = evaluateReview(response({ destructive: 0.97, session_created_cleanup: 0.95 }), thresholds)
    expect(result).toEqual({ risk: 'low', decision: 'allow', reasons: [] })
  })

  it('fails closed when a required typed answer is missing', () => {
    const invalid = response()
    delete invalid.answers.security_change
    expect(() => evaluateReview(invalid, thresholds)).toThrow(/security_change/)
  })
})
