import { describe, expect, it, vi } from 'vitest'
import { API_KEY_REF, JevApiKeyResolver } from '../src/api-key.ts'
import { JevLiveSettings, JevEditableSchema } from '../src/settings-namespace.ts'

describe('JevApiKeyResolver', () => {
  it('exposes the shared credential reference name', () => {
    expect(API_KEY_REF).toBe('TYPESAFE_API_KEY')
  })

  it('prefers the credential provider over the plugin config', async () => {
    const resolver = new JevApiKeyResolver({
      credentials: () => ({ resolve: async () => ({ value: 'from-credential', source: 'file' }) }),
      configured: () => 'from-config',
    })
    await expect(resolver.resolve()).resolves.toBe('from-credential')
  })

  it('falls back to the plugin config when no credential is stored', async () => {
    const resolve = vi.fn(async () => undefined)
    const resolver = new JevApiKeyResolver({ credentials: () => ({ resolve }), configured: () => 'from-config' })
    await expect(resolver.resolve()).resolves.toBe('from-config')
    expect(resolve).toHaveBeenCalledWith(API_KEY_REF)
  })

  it('returns undefined when neither source carries a key', async () => {
    const resolver = new JevApiKeyResolver({ credentials: () => ({ resolve: async () => undefined }), configured: () => '' })
    await expect(resolver.resolve()).resolves.toBeUndefined()
  })

  it('works without a credential provider at all', async () => {
    const resolver = new JevApiKeyResolver({ credentials: () => undefined, configured: () => 'from-config' })
    await expect(resolver.resolve()).resolves.toBe('from-config')
  })

  it('degrades to the config fallback when the provider throws', async () => {
    const resolver = new JevApiKeyResolver({
      credentials: () => ({ resolve: async () => { throw new Error('provider offline') } }),
      configured: () => 'from-config',
    })
    await expect(resolver.resolve()).resolves.toBe('from-config')
  })

  it('treats a blank credential as absent', async () => {
    const resolver = new JevApiKeyResolver({
      credentials: () => ({ resolve: async () => ({ value: '   ', source: 'file' }) }),
      configured: () => 'from-config',
    })
    await expect(resolver.resolve()).resolves.toBe('from-config')
  })

  it('re-resolves on every call so a saved key reaches the next operation', async () => {
    let stored = ''
    const resolver = new JevApiKeyResolver({
      credentials: () => ({ resolve: async () => (stored === '' ? undefined : { value: stored, source: 'user-env' }) }),
      configured: () => '',
    })
    await expect(resolver.resolve()).resolves.toBeUndefined()
    stored = 'pasted-in-settings'
    await expect(resolver.resolve()).resolves.toBe('pasted-in-settings')
  })
})

describe('JevLiveSettings', () => {
  it('serves the initial value before any commit', () => {
    const live = new JevLiveSettings({
      endpoint: 'https://a.test/v1',
      usageEndpoint: '',
      model: 'jev-latest',
      timeoutMs: 1000,
      usageRefreshSeconds: 300,
    })
    expect(live.read().endpoint).toBe('https://a.test/v1')
  })

  it('adopts a committed value', () => {
    const live = new JevLiveSettings({
      endpoint: 'https://a.test/v1',
      usageEndpoint: '',
      model: 'jev-latest',
      timeoutMs: 1000,
      usageRefreshSeconds: 300,
    })
    live.apply({ ...live.read(), endpoint: 'https://b.test/v1', usageEndpoint: 'https://b.test/usage' })
    expect(live.read().endpoint).toBe('https://b.test/v1')
    expect(live.read().usageEndpoint).toBe('https://b.test/usage')
  })

  it('resolves schema defaults for an empty user section', () => {
    const resolved = JevEditableSchema({} as never)
    expect(resolved.endpoint).toBe('https://api.typesafe.ai/v1/systemone')
    expect(resolved.model).toBe('jev-latest')
    expect(resolved.usageEndpoint).toBe('')
  })

  it('rejects a non-numeric interval through schema validation', () => {
    expect(() => JevEditableSchema({ usageRefreshSeconds: 'soon' } as never)).toThrow()
  })
})
