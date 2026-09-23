import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewCache } from '../src/review-cache.ts'
import type { ReviewDecision } from '../src/reviewer.ts'

/** One settled verdict per call, so the promise identity is observable. */
const decision = (label: string): Promise<ReviewDecision> =>
  Promise.resolve({ risk: 'low', decision: 'allow', reasons: [label] })

const IDENTITY = { endpoint: 'https://a.example/v1', model: 'jev-latest', apiKey: 'key-a' }

const T0 = Date.parse('2026-01-01T00:00:00Z')

afterEach(() => {
  vi.useRealTimers()
})

describe('ReviewCache', () => {
  it('serves the promise cached for the same identity and key', () => {
    const cache = new ReviewCache(60_000)
    const promise = decision('a')

    cache.set(IDENTITY, 'key', promise)

    expect(cache.get(IDENTITY, 'key')).toBe(promise)
    expect(cache.size).toBe(1)
  })

  it('voids every entry when the endpoint changes', () => {
    const cache = new ReviewCache(60_000)
    cache.set(IDENTITY, 'key', decision('a'))

    expect(cache.get({ ...IDENTITY, endpoint: 'https://b.example/v1' }, 'key')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('voids every entry when the model changes', () => {
    const cache = new ReviewCache(60_000)
    cache.set(IDENTITY, 'key', decision('a'))

    expect(cache.get({ ...IDENTITY, model: 'other' }, 'key')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('voids every entry when the API key changes', () => {
    const cache = new ReviewCache(60_000)
    cache.set(IDENTITY, 'key', decision('a'))

    // A verdict taken on one account must not be replayed on another.
    expect(cache.get({ ...IDENTITY, apiKey: 'key-b' }, 'key')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('adopts the new identity instead of staying poisoned after a void', () => {
    const cache = new ReviewCache(60_000)
    cache.set(IDENTITY, 'key', decision('a'))
    const rotated = { ...IDENTITY, apiKey: 'key-b' }
    expect(cache.get(rotated, 'key')).toBeUndefined()

    const second = decision('b')
    cache.set(rotated, 'key', second)

    expect(cache.get(rotated, 'key')).toBe(second)
    expect(cache.get(IDENTITY, 'key')).toBeUndefined()
  })

  it('expires an entry once its TTL has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const cache = new ReviewCache(1_000)
    cache.set(IDENTITY, 'key', decision('a'))

    vi.setSystemTime(T0 + 999)
    expect(cache.get(IDENTITY, 'key')).toBeDefined()

    vi.setSystemTime(T0 + 1_001)
    expect(cache.get(IDENTITY, 'key')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('evicts a rejected promise so the next call asks again', async () => {
    const cache = new ReviewCache(60_000)
    const promise = Promise.reject<ReviewDecision>(new Error('boom'))
    cache.set(IDENTITY, 'key', promise)

    await expect(promise).rejects.toThrow('boom')
    await Promise.resolve()

    expect(cache.get(IDENTITY, 'key')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('stores nothing when the TTL is zero (cache disabled)', () => {
    const cache = new ReviewCache(0)

    cache.set(IDENTITY, 'key', decision('a'))

    expect(cache.size).toBe(0)
    expect(cache.get(IDENTITY, 'key')).toBeUndefined()
  })

  it('reclaims expired entries on insert instead of growing without bound', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const cache = new ReviewCache(1_000)

    // 500 distinct states, 3 ms apart: a 1 s TTL window holds at most ~334.
    for (let i = 0; i < 500; i += 1) {
      cache.set(IDENTITY, `key-${i}`, decision(`d${i}`))
      vi.setSystemTime(T0 + i * 3)
    }
    expect(cache.size).toBeLessThan(400)

    // Past the last entry's expiry, one more insert sweeps the rest away.
    vi.setSystemTime(T0 + 500 * 3 + 2_000)
    cache.set(IDENTITY, 'final', decision('final'))

    expect(cache.size).toBe(1)
  })
})
