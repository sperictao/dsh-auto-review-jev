import { describe, expect, it } from 'vitest'
import {
  ALLOW_LABEL,
  KEEP_DENIED_LABEL,
  QUESTION_ID,
  answerAllows,
  createDenialAsker,
  denialQuestion,
  keepDeniedNote,
  type DenialQuestion,
  type UserQuestionsSeam,
} from '../src/ask-on-deny.ts'

/** A denial exactly as the transcript would show it. */
const DENIAL =
  'Jev Auto review rejected tool "bash"; its body was not executed — medium: destructive=0.91'

const CALL = {
  toolName: 'bash',
  denialText: DENIAL,
  signal: new AbortController().signal,
} as const

/** One captured seam call. */
interface Captured {
  readonly agent: unknown
  readonly signal: AbortSignal | undefined
  readonly questions: readonly DenialQuestion[]
}

/** A seam that records what it was asked and returns one canned answer item. */
function recordingSeam(
  answer: { id: string; selected: string[]; custom?: string } | undefined,
): { seam: UserQuestionsSeam; calls: Captured[] } {
  const calls: Captured[] = []
  return {
    calls,
    seam: {
      ask: async (request) => {
        calls.push({
          agent: request.agent,
          signal: request.signal,
          questions: request.questions,
        })
        return { answers: answer === undefined ? [] : [answer] }
      },
    },
  }
}

/** Let queued microtasks and the serialization chain advance. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A manually settled promise. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settled) => {
    resolve = settled
  })
  return { promise, resolve }
}

const answerWith = (label: string): { id: string; selected: string[] } => ({
  id: QUESTION_ID,
  selected: [label],
})

describe('denialQuestion', () => {
  it('asks about the reviewed tool and carries the original denial', () => {
    const question = denialQuestion('bash', DENIAL)
    expect(question.id).toBe(QUESTION_ID)
    expect(question.header).toBe('Auto Review Jev')
    expect(question.question).toContain('bash')
    expect(question.detail).toContain(DENIAL)
    expect(question.options.map((option) => option.label)).toEqual([ALLOW_LABEL, KEEP_DENIED_LABEL])
  })

  it('describes the consequence of both options', () => {
    for (const option of denialQuestion('bash', DENIAL).options) {
      expect(option.description.length).toBeGreaterThan(0)
    }
  })
})

describe('answerAllows', () => {
  it('grants only a recognisable allow', () => {
    expect(answerAllows(answerWith(ALLOW_LABEL))).toBe(true)
    expect(answerAllows({ selected: [ALLOW_LABEL, 'extra'] })).toBe(true)
    expect(answerAllows({ selected: [] })).toBe(false)
    expect(answerAllows({ selected: [KEEP_DENIED_LABEL] })).toBe(false)
    expect(answerAllows(undefined)).toBe(false)
  })

  it('accepts a free-text allow from either language, and nothing else', () => {
    for (const text of ['allow', 'Yes', 'ok ', '允许', '允许本次执行', '执行']) {
      expect(answerAllows({ selected: [], custom: text }), text).toBe(true)
    }
    for (const text of ['', '   ', 'maybe', 'deny', '不要执行', 'allow me to explain']) {
      expect(answerAllows({ selected: [], custom: text }), text).toBe(false)
    }
  })

  it('ignores a free text that accompanies the keep-denied label', () => {
    expect(answerAllows({ selected: [KEEP_DENIED_LABEL], custom: 'why' })).toBe(false)
  })
})

describe('keepDeniedNote', () => {
  it('says nothing when the call was granted', () => {
    expect(keepDeniedNote({ kind: 'allow' })).toBe('')
  })

  it('explains every other outcome', () => {
    expect(keepDeniedNote({ kind: 'denied' })).toContain('kept the denial')
    expect(keepDeniedNote({ kind: 'unavailable' })).toContain('no user-questions answerer')
    expect(keepDeniedNote({ kind: 'aborted' })).toContain('aborted')
    expect(keepDeniedNote({ kind: 'error', error: new Error('boom') })).toContain('could not be asked')
  })
})

describe('createDenialAsker', () => {
  it('lifts exactly the call the human allowed, forwarding agent and signal', async () => {
    const { seam, calls } = recordingSeam(answerWith(ALLOW_LABEL))
    const agent = { id: 'agent-1' }
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })

    const result = await asker.ask({ ...CALL, agent })

    expect(result.kind).toBe('allow')
    const request = calls.at(0)
    if (request === undefined) throw new Error('the seam was never asked')
    expect(request.agent).toBe(agent)
    expect(request.signal).toBe(CALL.signal)
    const question = request.questions.at(0)
    if (question === undefined) throw new Error('no question was sent')
    expect(question.detail).toContain(DENIAL)
  })

  it('keeps the denial when the human keeps it', async () => {
    const { seam } = recordingSeam(answerWith(KEEP_DENIED_LABEL))
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })
    expect((await asker.ask(CALL)).kind).toBe('denied')
  })

  it('keeps the denial when the answerer returns nothing usable', async () => {
    const { seam } = recordingSeam(undefined)
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })
    expect((await asker.ask(CALL)).kind).toBe('denied')
  })

  it('warns once and keeps the denial when the profile has no seam', async () => {
    const warnings: string[] = []
    const asker = createDenialAsker({
      seam: () => undefined,
      warn: (message) => warnings.push(message),
    })
    expect((await asker.ask(CALL)).kind).toBe('unavailable')
    expect((await asker.ask(CALL)).kind).toBe('unavailable')
    expect(warnings).toHaveLength(1)
    expect(warnings.at(0)).toContain('userQuestions')
  })

  it('treats NO_PROVIDER as "nobody could be asked" and warns once', async () => {
    const warnings: string[] = []
    const failure = Object.assign(new Error('no user-questions answerer accepted the request'), {
      code: 'NO_PROVIDER',
    })
    const asker = createDenialAsker({
      seam: () => ({
        ask: async () => {
          throw failure
        },
      }),
      warn: (message) => warnings.push(message),
    })
    expect((await asker.ask(CALL)).kind).toBe('unavailable')
    expect(warnings).toHaveLength(1)
  })

  it('reports any other seam failure as an error and keeps the denial', async () => {
    const failure = Object.assign(
      new Error('human interaction is unavailable while the calling agent is owned by another live agent'),
      { code: 'DELEGATED_CALLER' },
    )
    const asker = createDenialAsker({
      seam: () => ({
        ask: async () => {
          throw failure
        },
      }),
      warn: () => {},
    })
    const result = await asker.ask(CALL)
    if (result.kind !== 'error') throw new Error(`expected an error, got ${result.kind}`)
    expect(result.error).toBe(failure)
  })

  it('never asks once the call is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let asked = 0
    const asker = createDenialAsker({
      seam: () => ({
        ask: async () => {
          asked += 1
          return { answers: [] }
        },
      }),
      warn: () => {},
    })
    const result = await asker.ask({ ...CALL, signal: controller.signal })
    expect(result.kind).toBe('aborted')
    expect(asked).toBe(0)
  })

  it('serializes prompts that share one agent, so questions cannot stack', async () => {
    const gate = deferred<{ answers: { id: string; selected: string[] }[] }>()
    const order: string[] = []
    let seen = 0
    const seam: UserQuestionsSeam = {
      ask: async () => {
        seen += 1
        const index = seen
        order.push(`start${index}`)
        if (index === 1) return await gate.promise
        order.push(`end${index}`)
        return { answers: [answerWith(KEEP_DENIED_LABEL)] }
      },
    }
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })
    const agent = { id: 'agent-1' }

    const first = asker.ask({ ...CALL, agent, queueKey: agent })
    const second = asker.ask({ ...CALL, agent, queueKey: agent })
    await flush()
    expect(order).toEqual(['start1'])

    gate.resolve({ answers: [answerWith(ALLOW_LABEL)] })
    expect((await first).kind).toBe('allow')
    expect((await second).kind).toBe('denied')
    expect(order).toEqual(['start1', 'start2', 'end2'])
  })

  it('does not make distinct agents wait on each other', async () => {
    const gate = deferred<void>()
    const started: number[] = []
    let seen = 0
    const seam: UserQuestionsSeam = {
      ask: async () => {
        seen += 1
        started.push(seen)
        await gate.promise
        return { answers: [] }
      },
    }
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })
    const first = asker.ask({ ...CALL, queueKey: { id: 'a' } })
    const second = asker.ask({ ...CALL, queueKey: { id: 'b' } })
    await flush()
    expect(started).toEqual([1, 2])

    gate.resolve()
    expect((await first).kind).toBe('denied')
    expect((await second).kind).toBe('denied')
  })

  it('asks without a queue key when the caller has none', async () => {
    const { seam, calls } = recordingSeam(answerWith(ALLOW_LABEL))
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })
    expect((await asker.ask(CALL)).kind).toBe('allow')
    expect(calls).toHaveLength(1)
  })

  it('resolves to an error, never rejects, when the seam accessor throws (Cordis inject guard)', async () => {
    const failure = new Error('cannot get property "userQuestions" without inject')
    const asker = createDenialAsker({
      seam: () => {
        throw failure
      },
      warn: () => {},
    })
    const result = await asker.ask(CALL)
    if (result.kind !== 'error') throw new Error(`expected an error result, got ${result.kind}`)
    expect(result.error).toBe(failure)
    expect(keepDeniedNote(result)).toContain('could not be asked')
  })

  it('resolves to an error, never rejects, when the answerer returns a malformed payload', async () => {
    const asker = createDenialAsker({
      seam: () => ({
        ask: async () => ({ answers: undefined as never }),
      }),
      warn: () => {},
    })
    const result = await asker.ask(CALL)
    if (result.kind !== 'error') throw new Error(`expected an error result, got ${result.kind}`)
  })
})
