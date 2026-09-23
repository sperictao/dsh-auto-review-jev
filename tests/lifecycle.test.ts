import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AUTO_PRESET } from '@deepseek-ai/dsh-permission-presets'
import { RUN_CODE_NAME, type PreToolDecision, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { DENIAL_COPY, QUESTION_ID, type DenialQuestion } from '../src/ask-on-deny.ts'
import type { UserQuestionsSeam } from '../src/ask-on-deny.ts'
import type { CredentialResolver } from '../src/api-key.ts'
import { askJev } from '../src/client.ts'
import type { JevResponse } from '../src/client.ts'
import { apply } from '../src/index.ts'
import type { Config } from '../src/index.ts'

// The real usage service extends the Typert Remote base, which registers
// itself through a live Cordis context. The lifecycle under test only tells it
// about finished calls, so the service is stubbed and the Typert stack stays
// out of these tests.
// The language the browser reported, as the Host would hold it. The stub reads
// it per call, like the real service does.
let uiLocale: string | undefined
vi.mock('../src/usage-remote.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/usage-remote.ts')>()),
  applyUsageRemote: () => ({
    recordCall: () => {},
    refreshAccount: async () => {},
    report: async () => ({}),
    uiLocale: () => uiLocale,
  }),
}))

// Only the network call is replaced: the constants, the error class and the
// endpoint rule stay the real ones.
vi.mock('../src/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client.ts')>()),
  askJev: vi.fn(),
}))

const BASE_CONFIG: Config = {
  apiKey: 'test-key',
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  usageEndpoint: '',
  usageRefreshSeconds: 300,
  askOnDeny: true,
  preset: AUTO_PRESET,
  model: 'jev-latest',
  timeoutMs: 20_000,
  retries: 2,
  maxStateChars: 12_000,
  argumentChars: 600,
  cacheSeconds: 0,
  sensitiveExfiltrationThreshold: 0.70,
  destructiveThreshold: 0.90,
  productionEffectThreshold: 0.80,
  externalWriteThreshold: 0.80,
  securityChangeThreshold: 0.80,
  beyondScopeThreshold: 0.85,
  explicitAuthorizationThreshold: 0.85,
  authorizationConflictThreshold: 0.50,
  sessionCreatedCleanupThreshold: 0.80,
  impactThreshold: 2.50,
  minImpactConfidence: 0.50,
}

const ANSWER_IDS = [
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

/** A Jev response in the shape `evaluateReview` consumes (see tests/reviewer.test.ts). */
function jevResponse(values: Record<string, number> = {}): JevResponse {
  const answers = Object.fromEntries(ANSWER_IDS.map(id => [id, { type: 'noul' as const, noul: values[id] ?? 0 }]))
  return { model: 'jev-latest', answers: { ...answers, impact: { type: 'score', score: 0, confidence: 1 } } }
}

const ALLOW_RESPONSE = jevResponse()
const DENY_RESPONSE = jevResponse({ sensitive_exfiltration: 0.95 })

const ARGS_JSON = '{"command":"ls"}'

/**
 * The smallest session log `snapshotReview` accepts for a native root call:
 * the seq of every event is its array index, and the assistant's tool-call
 * block spells the arguments exactly as the `tool/call` event logs them
 * (snapshotReview compares the two with ===).
 */
function sessionFixture(): unknown {
  const events = [
    {
      seq: 0,
      type: 'user/message',
      data: { source: { kind: 'user', rpcId: 'rpc-1' }, content: [{ type: 'text', text: 'list the files' }] },
    },
    { seq: 1, type: 'step/start', data: { turn: 1, step: 1 } },
    {
      seq: 2,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'tool-call', id: 'call-1', name: 'bash', arguments: ARGS_JSON }] },
      },
    },
    { seq: 3, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: ARGS_JSON } },
  ]
  return {
    header: { cwd: '/tmp/work', origin: 'user' },
    isOwnSeq: () => true,
    snapshotEvents: () => events,
    surface: { nodes: [0, 1, 2, 3] },
    requestHeader: () => ({
      tools: [{ name: 'bash', description: 'run a shell command', parameters: { type: 'object' } }],
    }),
  }
}

/**
 * Overrides for one fixture. `agent` is spelled out because
 * `exactOptionalPropertyTypes` makes a bare `Partial<ToolExecution>` reject an
 * explicit `undefined` — and the agentless case needs exactly that.
 */
type ExecOverrides = Omit<Partial<ToolExecution>, 'agent'> & { agent?: ToolExecution['agent'] | undefined }

function execFor(session: unknown, overrides: ExecOverrides = {}): ToolExecution {
  return {
    agent: { session },
    name: 'bash',
    arguments: { command: 'ls' },
    rootCallId: 'call-1',
    parent: undefined,
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as ToolExecution
}

type Listener = (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>

interface HarnessOptions {
  config?: Partial<Config>
  registerAuto?: () => () => Promise<void>
  presetNames?: readonly string[]
  sessionPreset?: string
  credentials?: CredentialResolver
  session?: unknown
  userQuestions?: UserQuestionsSeam
}

/**
 * A stand-in for the Cordis context the plugin entry consumes.
 *
 * `effect` runs a generator callback eagerly and collects what it yields —
 * that is how the lifecycle effect registers its listener at apply() time —
 * and calls those disposers in reverse on dispose. `inject` resolves only the
 * services a test supplies: an absent `settings` service models a headless
 * profile, and an absent `credentials` service makes the config `apiKey` the
 * only key layer.
 */
function harness(options: HarnessOptions = {}): {
  listener: Listener
  dispose: () => Promise<void>
  presetOf: () => string | undefined
  exec: (overrides?: ExecOverrides) => ToolExecution
} {
  const config: Config = { ...BASE_CONFIG, ...options.config }
  const session = options.session ?? sessionFixture()
  const presetBySession = new Map<unknown, string>([[session, options.sessionPreset ?? AUTO_PRESET]])
  const presets = {
    names: options.presetNames ?? [AUTO_PRESET, 'workspace-write'],
    registerAuto: options.registerAuto ?? (() => async () => {}),
    current: (target: unknown): string | undefined => presetBySession.get(target),
    set: (target: unknown, name: string): void => {
      presetBySession.set(target, name)
    },
  }

  let listener: Listener | undefined
  const disposers: Array<() => unknown> = []

  const runEffect = (callback: unknown): void => {
    if (typeof callback !== 'function') return
    const produced = (callback as () => unknown)()
    if (typeof produced !== 'object' || produced === null || typeof (produced as Iterator<unknown>).next !== 'function') return
    const iterator = produced as Iterator<unknown>
    let step = iterator.next()
    while (step.done !== true) {
      if (typeof step.value === 'function') disposers.push(step.value as () => unknown)
      step = iterator.next()
    }
  }

  const ctx = {
    permissionPresets: presets,
    sessions: { list: () => [session] },
    logger: { warn: () => {} },
    provide: () => {},
    get: (name: string) => (name === 'userQuestions' ? options.userQuestions : undefined),
    on: (_event: string, handler: unknown) => {
      listener = handler as Listener
      return () => {}
    },
    effect: (callback: unknown) => {
      runEffect(callback)
      return async () => {}
    },
    inject: (names: readonly string[], callback: (ctx: unknown) => unknown) => {
      if (options.credentials === undefined || !names.includes('credentials')) return () => {}
      callback({ credentials: options.credentials, effect: () => () => {} })
      return () => {}
    },
  } as unknown as Context

  apply(ctx, config)

  return {
    listener: listener as Listener,
    presetOf: () => presets.current(session),
    // Bound to THIS harness's session: the preset gate compares the session
    // object the exec carries against the one the fake preset service tracks.
    exec: (overrides: ExecOverrides = {}) => execFor(session, overrides),
    dispose: async () => {
      for (const disposer of [...disposers].reverse()) await disposer()
    },
  }
}

const next = (): Promise<PreToolDecision> => Promise.resolve({ kind: 'allow' })
const mock = (): ReturnType<typeof vi.mocked<typeof askJev>> => vi.mocked(askJev)

beforeEach(() => {
  mock().mockReset()
  uiLocale = undefined
})

describe('the pre-execute listener', () => {
  it('passes through when another integration owns the auto slot', async () => {
    const test = harness({
      registerAuto: () => {
        throw new Error('permission: preset "auto" is already registered')
      },
      sessionPreset: AUTO_PRESET,
    })

    const decision = await test.listener(test.exec(), next)

    expect(decision).toEqual({ kind: 'allow' })
    expect(mock()).not.toHaveBeenCalled()
  })

  it('passes through for a session on another preset', async () => {
    const test = harness({ config: { preset: 'auto-jev' }, presetNames: ['auto-jev'], sessionPreset: 'workspace-write' })

    const decision = await test.listener(test.exec(), next)

    expect(decision).toEqual({ kind: 'allow' })
    expect(mock()).not.toHaveBeenCalled()
  })

  it('denies, without asking Jev, when no API key is configured', async () => {
    const test = harness({ config: { apiKey: '' } })

    const decision = await test.listener(test.exec(), next)

    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toContain('TYPESAFE_API_KEY')
    expect(mock()).not.toHaveBeenCalled()
  })

  it('denies with the review error when Jev fails', async () => {
    mock().mockRejectedValue(new Error('boom'))
    const test = harness({ config: { askOnDeny: false } })

    const decision = await test.listener(test.exec(), next)

    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toContain('review_error')
  })

  it('lifts the denial when the human answers an allow', async () => {
    mock().mockRejectedValue(new Error('boom'))
    const test = harness({
      userQuestions: {
        ask: async () => ({ answers: [{ id: QUESTION_ID, selected: [DENIAL_COPY.en.allow.label] }] }),
      },
    })

    const decision = await test.listener(test.exec(), next)

    expect(decision).toEqual({ kind: 'allow' })
  })

  it('keeps the denial when the human keeps it', async () => {
    mock().mockRejectedValue(new Error('boom'))
    const test = harness({
      userQuestions: {
        ask: async () => ({ answers: [{ id: QUESTION_ID, selected: [DENIAL_COPY.en.keep.label] }] }),
      },
    })

    const decision = await test.listener(test.exec(), next)

    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toContain('kept the denial')
  })

  it('keeps the denial when there is nobody to ask', async () => {
    mock().mockRejectedValue(new Error('boom'))
    const test = harness()

    const decision = await test.listener(test.exec(), next)

    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toContain('no user-questions answerer')
  })

  it('cancels a call that was in flight when the plugin was disposed', async () => {
    let settle!: (value: JevResponse) => void
    mock().mockImplementation(() => new Promise<JevResponse>((resolve) => {
      settle = resolve
    }))
    const test = harness({ config: { preset: 'auto-jev' }, presetNames: ['auto-jev'], sessionPreset: 'auto-jev' })

    const inFlight = test.listener(test.exec(), next)
    while (mock().mock.calls.length === 0) await Promise.resolve()

    // Disposal waits for `active`, so the listener is still engaged here.
    const disposal = test.dispose()
    const arrivedDuringTeardown = await test.listener(test.exec(), next)

    expect(arrivedDuringTeardown).toEqual({ kind: 'cancel' })

    // Jev's answer arrives after the abort: the in-flight call is cancelled
    // too, never allowed.
    settle(ALLOW_RESPONSE)
    await expect(inFlight).resolves.toEqual({ kind: 'cancel' })
    await disposal
  })

  it('stops deciding once disposed, leaving every call to the rest of the stack', async () => {
    mock().mockResolvedValue(ALLOW_RESPONSE)
    const test = harness({ config: { preset: 'auto-jev' }, presetNames: ['auto-jev'], sessionPreset: 'auto-jev' })
    await test.dispose()

    const decision = await test.listener(test.exec(), next)

    expect(decision).toEqual({ kind: 'allow' })
    expect(mock()).not.toHaveBeenCalled()
  })

  it('restores a live Auto session to full access on dispose', async () => {
    const test = harness({ sessionPreset: AUTO_PRESET })
    expect(test.presetOf()).toBe(AUTO_PRESET)

    await test.dispose()

    expect(test.presetOf()).toBe('danger-full-access')
  })

  it('never reviews the code runner itself, nor a call with no agent', async () => {
    const test = harness({})

    const codeRunner = await test.listener(test.exec({ name: RUN_CODE_NAME }), next)
    const agentless = await test.listener(test.exec({ agent: undefined }), next)

    expect(codeRunner).toEqual({ kind: 'allow' })
    expect(agentless).toEqual({ kind: 'allow' })
    expect(mock()).not.toHaveBeenCalled()
  })

  it('refuses to boot on an endpoint that would leak the key', () => {
    const withBadEndpoint = { ...BASE_CONFIG, endpoint: 'http://api.example/v1' }
    expect(() => apply({} as unknown as Context, withBadEndpoint)).toThrow(/https/)

    const withBadUsage = { ...BASE_CONFIG, usageEndpoint: 'not a url' }
    expect(() => apply({} as unknown as Context, withBadUsage)).toThrow(/absolute URL/)
  })
})

describe('the decide paths', () => {
  it('allows a call Jev clears', async () => {
    mock().mockResolvedValue(ALLOW_RESPONSE)
    const test = harness()

    const decision = await test.listener(test.exec(), next)

    expect(decision).toEqual({ kind: 'allow' })
    expect(mock()).toHaveBeenCalledTimes(1)
    const call = mock().mock.calls[0]?.[0]
    expect(call?.apiKey).toBe('test-key')
    expect(call?.endpoint).toBe(BASE_CONFIG.endpoint)
    expect(call?.model).toBe(BASE_CONFIG.model)
  })

  it('denies a call Jev refuses, naming the risk', async () => {
    mock().mockResolvedValue(DENY_RESPONSE)
    const test = harness({ config: { askOnDeny: false } })

    const decision = await test.listener(test.exec(), next)

    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toContain('sensitive_exfiltration')
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it('asks Jev once for the same call within the cache window', async () => {
    mock().mockResolvedValue(ALLOW_RESPONSE)
    const test = harness({ config: { cacheSeconds: 120 } })
    const exec = test.exec()

    const first = await test.listener(exec, next)
    const second = await test.listener(exec, next)

    expect(first).toEqual(second)
    expect(mock()).toHaveBeenCalledTimes(1)
  })

  it('keeps each plugin instance on its own cache', async () => {
    mock().mockResolvedValueOnce(DENY_RESPONSE).mockResolvedValueOnce(ALLOW_RESPONSE)
    const denying = harness({ config: { cacheSeconds: 120, askOnDeny: false } })
    const allowing = harness({ config: { cacheSeconds: 120 } })

    const denied = await denying.listener(denying.exec(), next)
    const allowed = await allowing.listener(allowing.exec(), next)

    expect(denied.kind).toBe('deny')
    expect(allowed).toEqual({ kind: 'allow' })
    expect(mock()).toHaveBeenCalledTimes(2)
  })

  it('re-resolves the key on later calls', async () => {
    mock().mockResolvedValue(ALLOW_RESPONSE)
    let keys = 0
    const credentials: CredentialResolver = {
      resolve: async () => ({ value: keys++ === 0 ? 'key-a' : 'key-b', source: 'test' }),
    }
    const test = harness({ credentials, config: { cacheSeconds: 120 } })
    const exec = test.exec()

    await test.listener(exec, next)
    await test.listener(exec, next)

    expect(mock()).toHaveBeenCalledTimes(2)
    expect(mock().mock.calls[0]?.[0].apiKey).toBe('key-a')
    expect(mock().mock.calls[1]?.[0].apiKey).toBe('key-b')
  })
})

describe('the reprieve dialog', () => {
  it('speaks the language the Web UI reported, and shows what the review found', async () => {
    uiLocale = 'zh-CN'
    mock().mockResolvedValue(DENY_RESPONSE)
    let asked: DenialQuestion | undefined
    const test = harness({
      userQuestions: {
        ask: async (request) => {
          asked = request.questions[0]
          return { answers: [{ id: QUESTION_ID, selected: [DENIAL_COPY.zh.keep.label] }] }
        },
      },
    })

    const decision = await test.listener(test.exec(), next)

    expect(decision.kind).toBe('deny')
    if (asked === undefined) throw new Error('the seam was never asked')
    expect(asked.question).toContain('是否允许')
    expect(asked.options.map(option => option.label)).toEqual([
      DENIAL_COPY.zh.allow.label,
      DENIAL_COPY.zh.keep.label,
    ])
    // The point of the dialog: the findings behind the verdict, not just the
    // verdict, and the call about to run.
    expect(asked.detail).toContain('高风险')
    expect(asked.detail).toContain('已拒绝')
    expect(asked.detail).toContain('敏感数据外泄')
    expect(asked.detail).toContain('工具：bash')
    expect(asked.detail).toContain('ls')
  })

  it('falls back to English when no browser ever reported a language', async () => {
    mock().mockResolvedValue(DENY_RESPONSE)
    let asked: DenialQuestion | undefined
    const test = harness({
      userQuestions: {
        ask: async (request) => {
          asked = request.questions[0]
          return { answers: [{ id: QUESTION_ID, selected: [DENIAL_COPY.en.keep.label] }] }
        },
      },
    })

    await test.listener(test.exec(), next)

    expect(asked?.question).toContain('Allow this one call')
    expect(asked?.detail).toContain('sensitive data exfiltration')
  })
})
