import { describe, expect, it } from 'vitest'
import { JevSettingsController } from '../src/client/settings.ts'
import type { ConfigForm, SettingsPageApi } from '../src/client/settings.ts'

/** The wire face the controller needs; every credential call succeeds. */
function fakeApi(): SettingsPageApi {
  return {
    credentials: {
      async describe() {
        return { ok: true, value: {} }
      },
      async set() {
        return { ok: true }
      },
      async unset() {
        return { ok: true }
      },
    },
  }
}

/**
 * A settings form over one in-memory section, plus the field writes it saw.
 * `accept: false` models the Host refusing a value its namespace validation
 * rejects, which the real `ConfigForm` answers with `false` rather than a
 * rejection.
 */
function fakeForm(
  initial: Record<string, unknown>,
  accept: boolean,
): { form: ConfigForm<Record<string, unknown>>; writes: string[] } {
  let value = { ...initial }
  const writes: string[] = []
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    writes,
    form: {
      getSnapshot: () => ({
        status: 'ready',
        value,
        base: initial,
        user: value,
        revision: 1,
        writable: true,
        mode: 'host',
      }),
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      async set(field, next) {
        writes.push(`set:${field}`)
        if (!accept) return false
        value = { ...value, [field]: next }
        publish()
        return true
      },
      async unset(field) {
        writes.push(`unset:${field}`)
        if (!accept) return false
        const next = { ...value }
        delete next[field]
        value = next
        publish()
        return true
      },
    },
  }
}

const STORED = { endpoint: 'https://a.example/v1' }

describe('JevSettingsController against the config-form contract', () => {
  it('reports a write the Host refused instead of claiming success', async () => {
    const { form } = fakeForm(STORED, false)
    const controller = new JevSettingsController(form, fakeApi())
    controller.edit('endpoint', 'https://b.example/v1')

    await controller.save()

    expect(controller.state().failed).toBe(true)
    // The draft survives, so the page still offers the retry.
    expect(controller.state().dirty).toBe(true)
    expect(controller.state().endpoint.text).toBe('https://b.example/v1')
  })

  it('clears the draft once the Host accepts the write', async () => {
    const { form, writes } = fakeForm(STORED, true)
    const controller = new JevSettingsController(form, fakeApi())
    controller.edit('endpoint', 'https://b.example/v1')

    await controller.save()

    expect(writes).toEqual(['set:endpoint'])
    expect(controller.state().failed).toBe(false)
    expect(controller.state().dirty).toBe(false)
    expect(controller.state().endpoint.text).toBe('https://b.example/v1')
  })

  it('never asks the Host to store what it already holds', async () => {
    const { form, writes } = fakeForm(STORED, false)
    const controller = new JevSettingsController(form, fakeApi())
    // A draft that differs only by surrounding whitespace stages an edit whose
    // trimmed value equals the stored one.
    controller.edit('endpoint', '  https://a.example/v1  ')

    await controller.save()

    expect(writes).toEqual([])
    expect(controller.state().failed).toBe(false)
    expect(controller.state().dirty).toBe(false)
  })
})
