/**
 * Typed Jev authorization reviewer for the DeepSeek Harness Auto permission preset.
 *
 * DSH owns permission selection, execution and lifecycle. Jev only answers a
 * fixed set of typed questions; this plugin turns those numbers into a local,
 * deterministic allow/deny decision and fails closed on review errors.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-instructions'
import type { ContentBlock, MessageSource, ToolCallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import { AUTO_PRESET } from '@deepseek-ai/dsh-permission-presets'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { RUN_CODE_NAME, type PreToolDecision, type ToolExecution } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  askJev,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
} from './client.ts'
import {
  buildReviewState,
  evaluateReview,
  REVIEW_QUESTIONS,
  type ReviewDecision,
  type Thresholds,
} from './reviewer.ts'

const DENIED_ERROR_NAME = 'JevAutoReviewDeniedError'
const DENIED_ERROR_CODE = 'JEV_AUTO_REVIEW_DENIED'
const API_KEY_ENV = 'TYPESAFE_API_KEY'

export const name = 'dsh-auto-review-jev'
export const inject = ['permissionPresets', 'sessions', 'tools']

export interface Config {
  apiKey: string
  endpoint: string
  model: string
  timeoutMs: number
  retries: number
  maxStateChars: number
  argumentChars: number
  cacheSeconds: number
  sensitiveExfiltrationThreshold: number
  destructiveThreshold: number
  productionEffectThreshold: number
  externalWriteThreshold: number
  securityChangeThreshold: number
  beyondScopeThreshold: number
  explicitAuthorizationThreshold: number
  authorizationConflictThreshold: number
  sessionCreatedCleanupThreshold: number
  impactThreshold: number
  minImpactConfidence: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().default(''),
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  model: z.string().default(DEFAULT_MODEL),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  retries: z.number().default(DEFAULT_RETRIES),
  maxStateChars: z.number().default(12_000),
  argumentChars: z.number().default(600),
  cacheSeconds: z.number().default(120),
  sensitiveExfiltrationThreshold: z.number().default(0.70),
  destructiveThreshold: z.number().default(0.90),
  productionEffectThreshold: z.number().default(0.80),
  externalWriteThreshold: z.number().default(0.80),
  securityChangeThreshold: z.number().default(0.80),
  beyondScopeThreshold: z.number().default(0.85),
  explicitAuthorizationThreshold: z.number().default(0.85),
  authorizationConflictThreshold: z.number().default(0.50),
  sessionCreatedCleanupThreshold: z.number().default(0.80),
  impactThreshold: z.number().default(2.50),
  minImpactConfidence: z.number().default(0.50),
})

type ReviewSourceRole =
  | 'human-instruction'
  | 'direct-parent-instruction'
  | 'constraint'
  | 'checkpoint'
  | 'fact'

interface HistoricalUserMessage {
  readonly kind: 'user-message'
  readonly role: ReviewSourceRole
  readonly source: MessageSource
  readonly content: readonly ContentBlock[]
}

interface HistoricalToolCall {
  readonly kind: 'tool-call'
  readonly role: 'fact'
  readonly mode: 'native' | 'ptc-inner'
  readonly name: string
  readonly arguments: string
}

type HistoricalEntry = HistoricalUserMessage | HistoricalToolCall

interface PendingAction {
  readonly mode: 'native' | 'ptc-inner'
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly arguments: unknown
}

type NativeCallEvent = Extract<SessionEvent, { type: 'tool/call' }>
type PtcStartEvent = Extract<SessionEvent, { type: 'tool/ptc-dispatch-start' }>

interface StepIdentity {
  readonly turn: number
  readonly step: number
}

interface ScopedPtcStart {
  readonly event: PtcStartEvent
  readonly step: StepIdentity
}

interface ReviewSnapshot {
  readonly cwd: string
  readonly projectInstructions: readonly HistoricalUserMessage[]
  readonly history: readonly HistoricalEntry[]
  readonly action: PendingAction
}

interface CacheEntry {
  readonly expiresAt: number
  readonly promise: Promise<ReviewDecision>
}


function validateConfig(config: Config): void {
  const ratios: Array<[string, number]> = [
    ['sensitiveExfiltrationThreshold', config.sensitiveExfiltrationThreshold],
    ['destructiveThreshold', config.destructiveThreshold],
    ['productionEffectThreshold', config.productionEffectThreshold],
    ['externalWriteThreshold', config.externalWriteThreshold],
    ['securityChangeThreshold', config.securityChangeThreshold],
    ['beyondScopeThreshold', config.beyondScopeThreshold],
    ['explicitAuthorizationThreshold', config.explicitAuthorizationThreshold],
    ['authorizationConflictThreshold', config.authorizationConflictThreshold],
    ['sessionCreatedCleanupThreshold', config.sessionCreatedCleanupThreshold],
    ['minImpactConfidence', config.minImpactConfidence],
  ]
  for (const [name, value] of ratios) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`dsh-auto-review-jev: ${name} must be between 0 and 1`)
    }
  }
  if (!Number.isFinite(config.impactThreshold) || config.impactThreshold < 0 || config.impactThreshold > 3) {
    throw new Error('dsh-auto-review-jev: impactThreshold must be between 0 and 3')
  }
  if (!Number.isInteger(config.retries) || config.retries < 0) {
    throw new Error('dsh-auto-review-jev: retries must be a non-negative integer')
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1000) {
    throw new Error('dsh-auto-review-jev: timeoutMs must be at least 1000')
  }
  if (!Number.isInteger(config.maxStateChars) || config.maxStateChars < 2000) {
    throw new Error('dsh-auto-review-jev: maxStateChars must be an integer >= 2000')
  }
  if (!Number.isInteger(config.argumentChars) || config.argumentChars < 80) {
    throw new Error('dsh-auto-review-jev: argumentChars must be an integer >= 80')
  }
  if (!Number.isFinite(config.cacheSeconds) || config.cacheSeconds < 0) {
    throw new Error('dsh-auto-review-jev: cacheSeconds must be non-negative')
  }
}

function resolveApiKey(config: Config): string | undefined {
  const fromEnv = process.env[API_KEY_ENV]?.trim()
  if (fromEnv) return fromEnv
  const configured = config.apiKey.trim()
  return configured.length > 0 ? configured : undefined
}

function thresholds(config: Config): Thresholds {
  return {
    sensitiveExfiltration: config.sensitiveExfiltrationThreshold,
    destructive: config.destructiveThreshold,
    productionEffect: config.productionEffectThreshold,
    externalWrite: config.externalWriteThreshold,
    securityChange: config.securityChangeThreshold,
    beyondScope: config.beyondScopeThreshold,
    explicitAuthorization: config.explicitAuthorizationThreshold,
    authorizationConflict: config.authorizationConflictThreshold,
    sessionCreatedCleanup: config.sessionCreatedCleanupThreshold,
    impact: config.impactThreshold,
    minImpactConfidence: config.minImpactConfidence,
  }
}

function json(value: unknown): string {
  const rendered = JSON.stringify(value)
  if (rendered === undefined) throw new Error('review state contains a non-serializable value')
  return rendered
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function loggedSchema(
  value: { readonly description?: unknown; readonly parameters?: unknown },
  expectedName: string,
): ToolSchema {
  if (typeof value.description !== 'string' || !isRecord(value.parameters)) {
    throw new Error(`pending tool schema for "${expectedName}" is incomplete`)
  }
  return { name: expectedName, description: value.description, parameters: value.parameters }
}

function parseLoggedArguments(raw: string): unknown {
  if (raw === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function isHumanInstruction(source: MessageSource): boolean {
  return source.kind === 'user'
    && typeof (source as { readonly rpcId?: unknown }).rpcId === 'string'
}

function isProjectInstruction(source: MessageSource): boolean {
  return source.kind === 'agent-instructions'
}

function isCheckpoint(source: MessageSource): boolean {
  return source.kind === 'plugin' && source.plugin === 'compact'
}

function isDirectParentInstruction(source: MessageSource, parentSession: string | undefined): boolean {
  return parentSession !== undefined
    && source.kind === 'agent-message'
    && (source as { readonly senderSessionId?: unknown }).senderSessionId === parentSession
}

function directParentInitialPromptSeq(
  agent: Agent,
  events: readonly SessionEvent[],
): SessionEvent['seq'] | undefined {
  const { session } = agent
  if (session.header.origin !== 'subagent' || session.header.parentSession === undefined) return undefined
  let passedCreationBoundary = false
  for (const event of events) {
    if (!session.isOwnSeq(event.seq)) continue
    if (event.type === 'subagent/descriptor') {
      passedCreationBoundary = true
      continue
    }
    if (passedCreationBoundary
      && event.type === 'user/message'
      && event.data.source.kind === 'user'
      && !isHumanInstruction(event.data.source)) {
      return event.seq
    }
  }
  return undefined
}

function textRole(
  source: MessageSource,
  seq: SessionEvent['seq'],
  initialPromptSeq: SessionEvent['seq'] | undefined,
  parentSession: string | undefined,
): ReviewSourceRole {
  if (isHumanInstruction(source)) return 'human-instruction'
  if (seq === initialPromptSeq || isDirectParentInstruction(source, parentSession)) {
    return 'direct-parent-instruction'
  }
  if (isCheckpoint(source)) return 'checkpoint'
  return 'fact'
}

function filteredUserEntries(
  seq: SessionEvent['seq'],
  source: MessageSource,
  content: readonly ContentBlock[],
  initialPromptSeq: SessionEvent['seq'] | undefined,
  parentSession: string | undefined,
): HistoricalUserMessage[] {
  const retained = content.filter(block => block.type !== 'tool-result')
  return retained.map(block => ({
    kind: 'user-message',
    role: block.type === 'text'
      ? textRole(source, seq, initialPromptSeq, parentSession)
      : 'fact',
    source,
    content: [block],
  }))
}

function stepIdentity(data: { readonly turn: number; readonly step: number }): StepIdentity {
  return { turn: data.turn, step: data.step }
}

function sameStep(left: StepIdentity, right: StepIdentity): boolean {
  return left.turn === right.turn && left.step === right.step
}

function scopedCallKey(step: StepIdentity, callId: ToolCallId): string {
  return `${step.turn}\0${step.step}\0${callId}`
}

function scopePtcStarts(events: readonly SessionEvent[]): {
  readonly starts: readonly ScopedPtcStart[]
  readonly openStep: StepIdentity | undefined
} {
  const starts: ScopedPtcStart[] = []
  let openStep: StepIdentity | undefined
  for (const event of events) {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      openStep = undefined
      continue
    }
    if (event.type === 'step/start') {
      openStep = stepIdentity(event.data)
      continue
    }
    if (event.type === 'step/end') {
      openStep = undefined
      continue
    }
    if (event.type !== 'tool/ptc-dispatch-start') continue
    if (openStep === undefined) throw new Error('PTC call has no owning step in the session log')
    starts.push({ event, step: openStep })
  }
  return { starts, openStep }
}

function nativeAction(
  exec: ToolExecution,
  headerTools: readonly ToolSchema[] | undefined,
  logged: NativeCallEvent,
): PendingAction {
  if (logged.data.name !== exec.name
    || !sameJson(parseLoggedArguments(logged.data.arguments), exec.arguments)) {
    throw new Error('pending native call disagrees with its logged action')
  }
  const candidates: readonly unknown[] = Array.isArray(headerTools) ? headerTools : []
  const schemas = candidates.filter((schema): schema is Record<string, unknown> =>
    isRecord(schema) && schema['name'] === exec.name)
  const [candidate] = schemas
  if (candidate === undefined || schemas.length !== 1) {
    throw new Error('pending native tool schema is missing or ambiguous')
  }
  const schema = loggedSchema(candidate, exec.name)
  return {
    mode: 'native',
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
    arguments: exec.arguments,
  }
}

function ptcAction(
  exec: ToolExecution,
  start: ScopedPtcStart,
  visibleParentKeys: ReadonlySet<string>,
): PendingAction {
  const { event } = start
  if (!visibleParentKeys.has(scopedCallKey(start.step, event.data.parentCallId))
    || event.data.rootCallId !== exec.rootCallId
    || event.data.name !== exec.name
    || !sameJson(event.data.arguments, exec.arguments)) {
    throw new Error('pending PTC call disagrees with its logged action')
  }
  if (exec.schema === undefined || exec.schema.name !== exec.name) {
    throw new Error('pending PTC binding schema is missing or inconsistent')
  }
  const schema = loggedSchema(exec.schema, exec.name)
  return {
    mode: 'ptc-inner',
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
    arguments: exec.arguments,
  }
}

/**
 * Reconstruct the same authority boundaries used by DSH Auto review: only
 * current human/direct-parent instructions authorize; project instructions,
 * checkpoints and historical calls are constraints/facts.
 */
function snapshotReview(agent: Agent, exec: ToolExecution): ReviewSnapshot {
  const { session } = agent
  // No projection exposes the full action history yet; this mirrors upstream Auto review.
  // eslint-disable-next-line deprecation/deprecation
  const events = session.snapshotEvents()
  const nodes = [...session.surface.nodes]
  const header = session.requestHeader()
  if (header === undefined) throw new Error('no request header is available for the pending call')
  const cwd = session.header.cwd
  if (cwd === undefined || cwd.length === 0) throw new Error('session has no working directory')

  const nativeCalls = events.filter((event: SessionEvent): event is NativeCallEvent => event.type === 'tool/call')
  const { starts, openStep: currentStep } = scopePtcStarts(events)
  const initialPromptSeq = directParentInitialPromptSeq(agent, events)

  const nativeByScopedId = new Map<string, NativeCallEvent[]>()
  for (const event of nativeCalls) {
    const key = scopedCallKey(stepIdentity(event.data), event.data.callId)
    const bucket = nativeByScopedId.get(key)
    if (bucket === undefined) nativeByScopedId.set(key, [event])
    else bucket.push(event)
  }

  const startsByParent = new Map<string, ScopedPtcStart[]>()
  const startsBySubCall = new Map<string, ScopedPtcStart>()
  for (const start of starts) {
    const subCallKey = scopedCallKey(start.step, start.event.data.subCallId)
    if (startsBySubCall.has(subCallKey)) throw new Error('PTC call identity is ambiguous')
    startsBySubCall.set(subCallKey, start)
    const parentKey = scopedCallKey(start.step, start.event.data.parentCallId)
    const bucket = startsByParent.get(parentKey)
    if (bucket === undefined) startsByParent.set(parentKey, [start])
    else bucket.push(start)
  }

  if (currentStep === undefined) throw new Error('pending call has no open step')
  const currentRootCalls = nativeByScopedId.get(scopedCallKey(currentStep, exec.rootCallId)) ?? []
  const currentRootCall = currentRootCalls[0]
  if (currentRootCall === undefined || currentRootCalls.length !== 1) {
    throw new Error('pending root call is missing or ambiguous')
  }
  const currentPtcStart = exec.parent === undefined
    ? undefined
    : startsBySubCall.get(scopedCallKey(currentStep, exec.callId))
  if (exec.parent !== undefined && currentPtcStart === undefined) {
    throw new Error('pending PTC call is missing or ambiguous')
  }

  const projectInstructions: HistoricalUserMessage[] = []
  const history: HistoricalEntry[] = []
  const visibleParentKeys = new Set<string>()
  let passedCurrentRoot = false

  for (const seq of nodes) {
    const event = events[seq]
    if (event === undefined) throw new Error('session surface references a missing event')
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'tool') continue
      if (isProjectInstruction(event.data.source)) {
        const content = event.data.content.filter((block: ContentBlock) => block.type !== 'tool-result')
        if (content.length > 0) {
          projectInstructions.push({
            kind: 'user-message',
            role: 'constraint',
            source: event.data.source,
            content,
          })
        }
      } else {
        history.push(...filteredUserEntries(
          event.seq,
          event.data.source,
          event.data.content,
          initialPromptSeq,
          session.header.parentSession,
        ))
      }
      continue
    }
    if (event.type !== 'assistant/message') continue

    const messageStep = stepIdentity(event.data)
    const isCurrentMessage = sameStep(messageStep, currentStep)
    let sawUnstartedSibling = false
    for (const block of event.data.message.content) {
      if (block.type !== 'tool-call') continue
      const key = scopedCallKey(messageStep, block.id)
      const isCurrentRoot = isCurrentMessage && block.id === exec.rootCallId
      if (isCurrentRoot && passedCurrentRoot) throw new Error('pending root call is ambiguous in the surface')

      const calls = nativeByScopedId.get(key) ?? []
      if (calls.length > 1) throw new Error('native call identity is ambiguous')
      const call = calls[0]
      const startsForCall = startsByParent.get(key) ?? []
      if (call === undefined) {
        if (isCurrentMessage && !passedCurrentRoot) {
          throw new Error('visible call before pending root is missing from the session log')
        }
        if (startsForCall.length > 0) throw new Error('unstarted visible call has PTC dispatches')
        sawUnstartedSibling = true
        continue
      }
      if (sawUnstartedSibling) throw new Error('visible native call logs do not form a started prefix')
      if (call.data.name !== block.name || call.data.arguments !== block.arguments) {
        throw new Error('visible tool call disagrees with its logged action')
      }

      visibleParentKeys.add(key)
      if (call !== currentRootCall || exec.parent !== undefined) {
        history.push({
          kind: 'tool-call',
          role: 'fact',
          mode: 'native',
          name: call.data.name,
          arguments: call.data.arguments,
        })
      }
      for (const start of startsForCall) {
        if (start === currentPtcStart) continue
        history.push({
          kind: 'tool-call',
          role: 'fact',
          mode: 'ptc-inner',
          name: start.event.data.name,
          arguments: json(start.event.data.arguments),
        })
      }
      if (isCurrentRoot) passedCurrentRoot = true
    }
  }

  if (!passedCurrentRoot) throw new Error('pending root call is missing from the current surface')
  const action = exec.parent === undefined
    ? nativeAction(exec, header.tools, currentRootCall)
    : ptcAction(exec, currentPtcStart as ScopedPtcStart, visibleParentKeys)

  return { cwd, projectInstructions, history, action }
}

function denial(exec: ToolExecution, detail?: string): PreToolDecision {
  return {
    kind: 'deny',
    reason: `Jev Auto review rejected tool "${exec.name}"; its body was not executed`,
    info: {
      name: DENIED_ERROR_NAME,
      code: DENIED_ERROR_CODE,
      ...(detail === undefined ? {} : { reason: detail }),
    },
  }
}

function compactError(error: unknown, apiKey: string | undefined): string {
  let text = error instanceof Error ? error.message : String(error)
  if (apiKey !== undefined && apiKey.length >= 8) text = text.split(apiKey).join('[redacted]')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

function decisionDetail(decision: ReviewDecision): string | undefined {
  if (decision.decision === 'allow') return undefined
  return [decision.risk, ...decision.reasons].join(': ')
}

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  const permissionPresets = ctx.permissionPresets
  const apiKey = resolveApiKey(config)
  const reviewThresholds = thresholds(config)
  const cache = new Map<string, CacheEntry>()
  let accepting = true
  const lifecycle = new AbortController()
  const active = new Set<Promise<void>>()

  const classify = async (agent: Agent, exec: ToolExecution, signal: AbortSignal): Promise<ReviewDecision> => {
    if (apiKey === undefined) throw new Error(`missing ${API_KEY_ENV}`)
    const snapshot = snapshotReview(agent, exec)
    const state = buildReviewState({
      cwd: snapshot.cwd,
      mode: snapshot.action.mode,
      tool: {
        name: snapshot.action.name,
        description: snapshot.action.description,
        parameters: snapshot.action.parameters,
      },
      arguments: snapshot.action.arguments,
      projectInstructions: [...snapshot.projectInstructions],
      history: [...snapshot.history],
    }, {
      argumentChars: config.argumentChars,
      maxStateChars: Math.floor(config.maxStateChars),
    })

    const key = JSON.stringify(state)
    const now = Date.now()
    const cached = cache.get(key)
    if (cached !== undefined && cached.expiresAt > now) return cached.promise
    if (cached !== undefined) cache.delete(key)

    const promise = askJev({
      state,
      questions: REVIEW_QUESTIONS,
      apiKey,
      endpoint: config.endpoint,
      model: config.model,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      signal,
    }).then(response => evaluateReview(response, reviewThresholds))

    if (config.cacheSeconds > 0) {
      cache.set(key, {
        expiresAt: now + Math.floor(config.cacheSeconds * 1000),
        promise,
      })
      void promise.catch(() => {
        if (cache.get(key)?.promise === promise) cache.delete(key)
      })
    }
    return promise
  }

  ctx.effect(function* () {
    const stopListener = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      const agent = exec.agent
      if (agent === undefined || (exec.parent === undefined && exec.name === RUN_CODE_NAME)) {
        return next()
      }
      if (permissionPresets.current(agent.session) !== AUTO_PRESET) return next()
      if (!accepting || lifecycle.signal.aborted) return { kind: 'cancel' }

      let resolveCompleted!: () => void
      const completed = new Promise<void>((resolve) => { resolveCompleted = resolve })
      active.add(completed)
      try {
        const signal = AbortSignal.any([exec.signal, lifecycle.signal])
        let decision: ReviewDecision
        try {
          decision = await classify(agent, exec, signal)
        } catch (error) {
          if (lifecycle.signal.aborted) return { kind: 'cancel' }
          return denial(exec, `review_error: ${compactError(error, apiKey)}`)
        }
        if (lifecycle.signal.aborted) return { kind: 'cancel' }
        if (decision.decision === 'deny') return denial(exec, decisionDetail(decision))
        return next()
      } finally {
        active.delete(completed)
        resolveCompleted()
      }
    }, { prepend: true })
    yield stopListener

    const stopContribution = permissionPresets.registerAuto(() => {
      if (!accepting) throw new Error('dsh-auto-review-jev integration is closing')
      if (apiKey === undefined) {
        throw new Error(`dsh-auto-review-jev requires ${API_KEY_ENV} (or plugin config apiKey)`)
      }
    })
    yield stopContribution

    yield async () => {
      accepting = false
      try {
        for (const session of ctx.sessions.list()) {
          if (permissionPresets.current(session) !== AUTO_PRESET) continue
          permissionPresets.set(session, 'danger-full-access')
        }
      } finally {
        lifecycle.abort(new Error('dsh-auto-review-jev integration disposed'))
        await Promise.allSettled([...active])
        cache.clear()
      }
    }
  }, 'dsh-auto-review-jev lifecycle')
}
