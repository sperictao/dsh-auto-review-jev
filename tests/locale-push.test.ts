import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { pushUiLocale } from '../src/client/locale-push.ts'
import type { LocalePushRemote } from '../src/client/locale-push.ts'

/** A locale runtime that reports `initial` until the fake switches it. */
function harness(initial = 'zh'): {
  sent: string[]
  emit: (active: string) => void
  dispose: () => void
  active: () => string
} {
  const sent: string[] = []
  let current = initial
  let listener: ((snapshot: { active: string }) => void) | undefined
  const teardown: Array<() => void> = []

  const namespace: LocalePushRemote = {
    setLocale: async (active: string) => {
      sent.push(active)
      return { ok: true, value: true }
    },
  }
  const ctx = {
    locale: { getLocale: () => ({ active: current, locales: [], revision: 0 }) },
    on: (_event: string, next: (snapshot: { active: string }) => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    },
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === 'function') teardown.push(disposer as () => void)
      return () => {}
    },
  } as unknown as Context

  pushUiLocale(ctx, namespace)
  return {
    sent,
    active: () => current,
    emit: (active: string) => {
      current = active
      listener?.({ active })
    },
    dispose: () => {
      for (const disposer of teardown) disposer()
    },
  }
}

describe('pushUiLocale', () => {
  it('reports the active locale as soon as the namespace is live', () => {
    // The dialog can appear before anyone opens Settings, so the first push
    // cannot wait for a locale change.
    expect(harness('zh').sent).toEqual(['zh'])
  })

  it('reports every later change', () => {
    const test = harness('zh')

    test.emit('en')
    test.emit('zh')

    expect(test.sent).toEqual(['zh', 'en', 'zh'])
  })

  it('stays quiet when the Host refuses or the push fails', async () => {
    let calls = 0
    const ctx = {
      locale: { getLocale: () => ({ active: 'zh', locales: [], revision: 0 }) },
      on: () => () => {},
      effect: () => () => {},
    } as unknown as Context
    const failing: LocalePushRemote = {
      setLocale: async () => {
        calls += 1
        throw new Error('gateway is gone')
      },
    }

    expect(() => pushUiLocale(ctx, failing)).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toBe(1)
  })

  it('stops reporting once the namespace context is disposed', () => {
    const test = harness('zh')

    test.dispose()
    test.emit('en')

    expect(test.sent).toEqual(['zh'])
  })
})
