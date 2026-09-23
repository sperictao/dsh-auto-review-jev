import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { askJev, fetchAccountUsage, JevError } from '../src/client.ts'
import { endpointProblem } from '../src/endpoint.ts'
import { REVIEW_QUESTIONS } from '../src/reviewer.ts'
import { applySettingsNamespace, JevLiveSettings } from '../src/settings-namespace.ts'
import type { JevEditableSettings } from '../src/settings-namespace.ts'

describe('endpointProblem', () => {
  it('accepts https destinations', () => {
    expect(endpointProblem('endpoint', 'https://api.typesafe.ai/v1/systemone')).toBeUndefined()
  })

  it('ignores surrounding whitespace', () => {
    expect(endpointProblem('endpoint', '  https://api.example/v1  ')).toBeUndefined()
  })

  it('accepts http for the loopback hosts a local proxy uses', () => {
    expect(endpointProblem('endpoint', 'http://localhost:8080/v1')).toBeUndefined()
    expect(endpointProblem('endpoint', 'http://127.0.0.1/v1')).toBeUndefined()
    expect(endpointProblem('endpoint', 'http://[::1]:8080/v1')).toBeUndefined()
  })

  it('refuses plain http anywhere else', () => {
    expect(endpointProblem('endpoint', 'http://api.example/v1')).toMatch(/https/)
  })

  it('refuses non-http schemes', () => {
    expect(endpointProblem('endpoint', 'ftp://api.example/v1')).toMatch(/https/)
    expect(endpointProblem('endpoint', 'file:///etc/passwd')).toMatch(/https/)
  })

  it('refuses values that are not absolute URLs', () => {
    expect(endpointProblem('endpoint', 'not a url')).toMatch(/absolute URL/)
    expect(endpointProblem('endpoint', 'https://')).toMatch(/absolute URL/)
    expect(endpointProblem('endpoint', '/v1/systemone')).toMatch(/absolute URL/)
  })

  it('names the offending field', () => {
    expect(endpointProblem('usageEndpoint', 'http://api.example/v1')).toContain('usageEndpoint')
  })

  it('leaves emptiness to the caller', () => {
    // Empty means "inherit the base" in the settings layer and "disabled" for
    // the usage endpoint, so the credential rule has nothing to say about it.
    expect(endpointProblem('endpoint', '')).toBeUndefined()
    expect(endpointProblem('endpoint', '   ')).toBeUndefined()
  })
})

describe('the request boundary', () => {
  it('refuses a plaintext usage endpoint before any request is made', async () => {
    await expect(fetchAccountUsage({ apiKey: 'k', usageEndpoint: 'http://api.example/v1' }))
      .rejects.toThrow(/https/)
  })

  it('refuses a plaintext evaluation endpoint before any request is made', async () => {
    const failure = askJev({
      state: { cwd: '/tmp/work' },
      questions: REVIEW_QUESTIONS,
      apiKey: 'k',
      endpoint: 'http://api.example/v1',
      retries: 0,
      signal: new AbortController().signal,
    })
    await expect(failure).rejects.toThrow(/https/)
    await expect(failure).rejects.toBeInstanceOf(JevError)
  })
})

describe('the settings write', () => {
  const BASE: JevEditableSettings = {
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    usageEndpoint: '',
    model: 'jev-latest',
    timeoutMs: 20_000,
    usageRefreshSeconds: 300,
  }

  /** A context whose settings inject captures the namespace's own validator. */
  function captureSettingsValidation(): (value: JevEditableSettings) => void {
    const captured: { validate?: (value: JevEditableSettings) => void } = {}
    const ctx = {
      inject: (names: readonly string[], callback: (ctx: unknown) => void) => {
        if (!names.includes('settings')) return () => {}
        callback({
          settings: {
            register: (
              _ns: string,
              _schema: unknown,
              options: { validate: (value: JevEditableSettings) => void },
            ) => {
              captured.validate = options.validate
              return { get: () => ({ ...BASE }), watch: () => () => {} }
            },
          },
          effect: () => () => {},
        })
        return () => {}
      },
    } as unknown as Context
    applySettingsNamespace(ctx, BASE, new JevLiveSettings(BASE))
    expect(captured.validate).toBeTypeOf('function')
    return captured.validate as (value: JevEditableSettings) => void
  }

  it('refuses a plaintext endpoint', () => {
    const validate = captureSettingsValidation()
    expect(() => validate({ ...BASE, endpoint: 'http://api.example/v1' })).toThrow(/https/)
    expect(() => validate({ ...BASE, usageEndpoint: 'http://api.example/v1' })).toThrow(/https/)
  })

  it('accepts an https endpoint and an empty one', () => {
    const validate = captureSettingsValidation()
    expect(() => validate({ ...BASE, endpoint: 'https://b.example/v1' })).not.toThrow()
    expect(() => validate({ ...BASE, endpoint: '' })).not.toThrow()
  })
})
