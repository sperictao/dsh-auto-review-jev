import { describe, expect, it } from 'vitest'
import {
  DENIAL_COPY,
  QUESTION_ID,
  answerAllows,
  createDenialAsker,
  denialLocale,
  denialQuestion,
  keepDeniedNote,
  type DenialFacts,
  type DenialQuestion,
  type UserQuestionsSeam,
} from '../src/ask-on-deny.ts'

/** The label an answer echoes back, per language: labels are the encoding. */
const ALLOW_EN = DENIAL_COPY.en.allow.label
const KEEP_EN = DENIAL_COPY.en.keep.label
const ALLOW_ZH = DENIAL_COPY.zh.allow.label
const KEEP_ZH = DENIAL_COPY.zh.keep.label

/** One refused call, as the pre-execute hook hands it over. */
const FACTS: DenialFacts = {
  toolName: 'bash',
  call: '{"command":"rm -rf build"}',
  risk: 'medium',
  reasons: ['destructive=0.91', 'explicit_authorization=0.12'],
}

const CALL = {
  facts: FACTS,
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

describe('denialLocale', () => {
  it('follows a Chinese UI, including its regional ids', () => {
    for (const id of ['zh', 'zh-CN', 'zh-Hans', ' ZH-TW ']) {
      expect(denialLocale(id), id).toBe('zh')
    }
  })

  it('answers in English for anything else, including nothing at all', () => {
    // English is also DSH's own fallback for a browser naming no registered
    // language and for non-browser runs.
    for (const id of ['en', 'en-US', 'ja', 'de-DE', '', undefined]) {
      expect(denialLocale(id), String(id)).toBe('en')
    }
  })
})

describe('denialQuestion', () => {
  it('writes the question and both options in the given language', () => {
    const zh = denialQuestion('zh', FACTS)
    const en = denialQuestion('en', FACTS)

    expect(zh.id).toBe(QUESTION_ID)
    expect(zh.header).toBe('Auto Review Jev')
    expect(zh.question).toContain('bash')
    expect(zh.question).toContain('是否允许')
    expect(zh.question).not.toContain('Allow')
    expect(zh.options.map((option) => option.label)).toEqual([ALLOW_ZH, KEEP_ZH])

    expect(en.question).toContain('bash')
    expect(en.question).toContain('Allow this one call')
    expect(en.question).not.toContain('是否')
    expect(en.options.map((option) => option.label)).toEqual([ALLOW_EN, KEEP_EN])
  })

  it('states the verdict, the dimensions that fired, the tool and the call', () => {
    const zh = denialQuestion('zh', FACTS).detail

    expect(zh).toContain('中风险')
    expect(zh).toContain('破坏性操作 0.91')
    expect(zh).toContain('显式授权 0.12')
    expect(zh).toContain('工具：bash')
    expect(zh).toContain('rm -rf build')

    const en = denialQuestion('en', FACTS).detail
    expect(en).toContain('medium risk')
    expect(en).toContain('destructive 0.91')
    expect(en).toContain('Tool: bash')
  })

  it('says the review could not complete when Jev failed', () => {
    const detail = denialQuestion('zh', { toolName: 'bash', error: 'review_error: HTTP 401' }).detail

    expect(detail).toContain('审查未能完成')
    expect(detail).toContain('HTTP 401')
    expect(detail).not.toContain('已拒绝')
  })

  it('keeps an unknown dimension visible instead of dropping it', () => {
    const detail = denialQuestion('en', { toolName: 'bash', risk: 'high', reasons: ['new_dimension=0.5'] }).detail

    expect(detail).toContain('new_dimension 0.5')
  })

  it('omits the call line when the caller had no arguments to render', () => {
    const detail = denialQuestion('en', { toolName: 'bash', risk: 'low' }).detail

    expect(detail).toContain('Tool: bash')
    expect(detail).not.toContain('Call:')
  })

  it('describes the consequence of both options', () => {
    for (const option of denialQuestion('en', FACTS).options) {
      expect(option.description.length).toBeGreaterThan(0)
    }
    for (const option of denialQuestion('zh', FACTS).options) {
      expect(option.description.length).toBeGreaterThan(0)
    }
  })
})

describe('answerAllows', () => {
  it('grants only a recognisable allow, in the language that was asked', () => {
    expect(answerAllows(answerWith(ALLOW_EN), ALLOW_EN)).toBe(true)
    expect(answerAllows({ selected: [ALLOW_EN, 'extra'] }, ALLOW_EN)).toBe(true)
    expect(answerAllows(answerWith(ALLOW_ZH), ALLOW_ZH)).toBe(true)
    expect(answerAllows({ selected: [] }, ALLOW_EN)).toBe(false)
    expect(answerAllows({ selected: [KEEP_EN] }, ALLOW_EN)).toBe(false)
    expect(answerAllows({ selected: [KEEP_ZH] }, ALLOW_ZH)).toBe(false)
    expect(answerAllows(undefined, ALLOW_EN)).toBe(false)
    // The label is the answer encoding, so a label from the other language is
    // not this question's allow.
    expect(answerAllows(answerWith(ALLOW_ZH), ALLOW_EN)).toBe(false)
  })

  it('accepts a free-text allow from either language, and nothing else', () => {
    for (const text of ['allow', 'Yes', 'ok ', '允许', '允许本次执行', '执行']) {
      expect(answerAllows({ selected: [], custom: text }, ALLOW_EN), text).toBe(true)
    }
    for (const text of ['', '   ', 'maybe', 'deny', '不要执行', 'allow me to explain']) {
      expect(answerAllows({ selected: [], custom: text }, ALLOW_EN), text).toBe(false)
    }
  })

  it('ignores a free text that accompanies the keep-denied label', () => {
    expect(answerAllows({ selected: [KEEP_EN], custom: 'why' }, ALLOW_EN)).toBe(false)
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
    const { seam, calls } = recordingSeam(answerWith(ALLOW_EN))
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
    expect(question.detail).toContain('destructive 0.91')
    expect(question.detail).toContain('bash')
  })

  it('asks in the language the caller reports, and matches that language\'s label', async () => {
    const { seam, calls } = recordingSeam(answerWith(ALLOW_ZH))
    const asker = createDenialAsker({ seam: () => seam, warn: () => {}, locale: () => 'zh-CN' })

    const result = await asker.ask(CALL)

    expect(result.kind).toBe('allow')
    const question = calls.at(0)?.questions.at(0)
    if (question === undefined) throw new Error('no question was sent')
    expect(question.question).toContain('是否允许')
    expect(question.options.map(option => option.label)).toEqual([ALLOW_ZH, KEEP_ZH])
  })

  it('keeps the denial when the human keeps it', async () => {
    const { seam } = recordingSeam(answerWith(KEEP_EN))
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
        return { answers: [answerWith(KEEP_EN)] }
      },
    }
    const asker = createDenialAsker({ seam: () => seam, warn: () => {} })
    const agent = { id: 'agent-1' }

    const first = asker.ask({ ...CALL, agent, queueKey: agent })
    const second = asker.ask({ ...CALL, agent, queueKey: agent })
    await flush()
    expect(order).toEqual(['start1'])

    gate.resolve({ answers: [answerWith(ALLOW_EN)] })
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
    const { seam, calls } = recordingSeam(answerWith(ALLOW_EN))
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
