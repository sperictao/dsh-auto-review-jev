import { endpointProblem } from './endpoint.ts'

export const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const DEFAULT_MODEL = 'jev-latest'
export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_RETRIES = 2

export type JevState = string | Record<string, unknown> | unknown[]

export interface NoulQuestion {
  type: 'noul'
  instructions: string
  criteria?: { true?: string; false?: string }
}

export interface ScoreQuestion {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type JevQuestion = NoulQuestion | ScoreQuestion

export interface NoulAnswer {
  type: 'noul'
  noul: number
}

export interface ScoreAnswer {
  type: 'score'
  score: number
  confidence?: number
  legend?: Record<string, string>
  probabilities?: Record<string, number>
}

export type JevAnswer = NoulAnswer | ScoreAnswer

export interface JevResponse {
  model: string
  answers: Record<string, JevAnswer>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Best-effort decode of the configured account-usage endpoint's body.
 *
 * TypeSafe's public HTTP API specifies no dedicated quota endpoint — only the
 * per-request `usage` token counts on each SystemOne response — so the plugin
 * supports an OPTIONAL account-usage endpoint (`GET <usageEndpoint>`, same
 * Bearer key) whose body shape is probed permissively: every field is read
 * under several common aliases and simply omitted when absent. This mirrors
 * the browser-side wire type in `./usage-wire.ts`; keep the two in sync.
 */
export interface JevAccountUsage {
  name?: string
  plan?: string
  balance?: number
  limit?: number
  used?: number
  remaining?: number
  tokenLimit?: number
  tokenUsed?: number
  currency?: string
  /** Millis timestamp at which the current period resets; 0 when unknown. */
  resetsAt?: number
}

export interface FetchAccountUsageCall {
  apiKey: string
  /** Absolute URL of the account-usage endpoint. */
  usageEndpoint: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface JevCall {
  state: JevState
  questions: Record<string, JevQuestion>
  apiKey: string
  model?: string
  endpoint?: string
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
}

export class JevError extends Error {
  readonly status: number | undefined
  readonly retryable: boolean

  constructor(message: string, status?: number, retryable = false) {
    super(message)
    this.name = 'JevError'
    this.status = status
    this.retryable = retryable
  }
}

const RETRYABLE_STATUS = new Set([429, 529])

export async function askJev(call: JevCall): Promise<JevResponse> {
  validateQuestions(call.questions)
  const endpoint = call.endpoint ?? DEFAULT_ENDPOINT
  const body = JSON.stringify({
    state: call.state,
    model: call.model ?? DEFAULT_MODEL,
    questions: call.questions,
  })
  const retries = call.retries ?? DEFAULT_RETRIES
  let lastError: JevError | undefined

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (call.signal?.aborted) break
    if (attempt > 0) await delay(Math.min(1000 * 2 ** (attempt - 1), 8000), call.signal)
    try {
      return await postOnce(endpoint, body, call)
    } catch (error) {
      const failure = asJevError(error)
      lastError = failure
      if (!failure.retryable) throw failure
    }
  }

  throw lastError ?? new JevError('request aborted')
}

/**
 * Fetch the account-side usage facts from the configured usage endpoint with
 * the same Bearer credential the evaluation calls use. No retries (this is a
 * background poll, not a decision path); failures surface as JevError.
 *
 * The body is decoded permissively (see {@link JevAccountUsage}): an endpoint
 * that reports only some fields — or nests its payload under `data` / `account`
 * / `usage` / `quota` — still yields the subset it actually carries.
 */
export async function fetchAccountUsage(call: FetchAccountUsageCall): Promise<JevAccountUsage> {
  // The last gate before the credential is attached to a request: a value
  // stored by an earlier version never passes today's validators again.
  const problem = endpointProblem('usageEndpoint', call.usageEndpoint)
  if (problem !== undefined) throw new JevError(problem)
  const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = call.signal === undefined ? timeout : AbortSignal.any([call.signal, timeout])
  const response = await fetch(call.usageEndpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      Accept: 'application/json',
    },
    signal,
  })
  const text = await response.text()

  if (!response.ok) {
    throw new JevError(
      `HTTP ${response.status}${statusHint(response.status)}: ${truncate(text, 400)}`,
      response.status,
      false,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new JevError(`response was not JSON: ${truncate(text, 200)}`, response.status)
  }
  return normalizeAccountUsage(parsed)
}

/** Read the first finite number found under any of `aliases` (snake_case and camelCase both listed). */
function pickNumber(source: Record<string, unknown>, aliases: readonly string[]): number | undefined {
  for (const key of aliases) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/** Read the first non-empty string found under any of `aliases`. */
function pickString(source: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const key of aliases) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** Epoch-millis from a number (s or ms) or an ISO-8601 string; undefined when unparsable. */
function pickTimestamp(source: Record<string, unknown>, aliases: readonly string[]): number | undefined {
  for (const key of aliases) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Heuristic: anything below 1e12 is epoch seconds, not millis.
      return value < 1e12 ? value * 1000 : value
    }
    if (typeof value === 'string') {
      const ms = Date.parse(value)
      if (Number.isFinite(ms)) return ms
    }
  }
  return undefined
}

/** Unwrap one level of common envelope keys (`data`, `account`, `usage`, `quota`, `billing`). */
function unwrapEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['data', 'account', 'usage', 'quota', 'billing'] as const) {
    const inner = value[key]
    if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as Record<string, unknown>
    }
  }
  return value
}

function normalizeAccountUsage(value: unknown): JevAccountUsage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new JevError('usage response was not an object')
  }
  const source = unwrapEnvelope(value as Record<string, unknown>)
  const out: JevAccountUsage = {}
  const name = pickString(source, ['name', 'account_name', 'org', 'organization'])
  const plan = pickString(source, ['plan', 'tier', 'plan_name', 'subscription'])
  const balance = pickNumber(source, ['balance', 'credit_balance', 'credits', 'grants'])
  const limit = pickNumber(source, ['limit', 'credit_limit', 'monthly_limit', 'cap', 'quota'])
  const used = pickNumber(source, ['used', 'usage', 'spent', 'consumed', 'credit_used'])
  const remaining = pickNumber(source, ['remaining', 'credit_remaining', 'available'])
  const tokenLimit = pickNumber(source, ['token_limit', 'tokens_limit', 'tokenLimit'])
  const tokenUsed = pickNumber(source, ['token_used', 'tokens_used', 'tokenUsed'])
  const currency = pickString(source, ['currency', 'currency_code'])
  const resetsAt = pickTimestamp(source, ['resets_at', 'reset_at', 'period_ends', 'renews_at', 'expires_at'])
  if (name !== undefined) out.name = name
  if (plan !== undefined) out.plan = plan
  if (balance !== undefined) out.balance = balance
  if (limit !== undefined) out.limit = limit
  if (used !== undefined) out.used = used
  if (remaining !== undefined) out.remaining = remaining
  if (tokenLimit !== undefined) out.tokenLimit = tokenLimit
  if (tokenUsed !== undefined) out.tokenUsed = tokenUsed
  if (currency !== undefined) out.currency = currency
  if (resetsAt !== undefined) out.resetsAt = resetsAt
  return out
}

async function postOnce(endpoint: string, body: string, call: JevCall): Promise<JevResponse> {
  // The last gate before the credential is attached to a request: a value
  // stored by an earlier version never passes today's validators again.
  const problem = endpointProblem('endpoint', endpoint)
  if (problem !== undefined) throw new JevError(problem)
  const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = call.signal === undefined ? timeout : AbortSignal.any([call.signal, timeout])
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
    signal,
  })
  const text = await response.text()

  if (!response.ok) {
    const retryable = RETRYABLE_STATUS.has(response.status) || response.status >= 500
    throw new JevError(
      `HTTP ${response.status}${statusHint(response.status)}: ${truncate(text, 400)}`,
      response.status,
      retryable,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new JevError(`response was not JSON: ${truncate(text, 200)}`, response.status)
  }
  return normalizeResponse(parsed)
}

function validateQuestions(questions: Record<string, JevQuestion>): void {
  const entries = Object.entries(questions)
  if (entries.length === 0) throw new JevError('no questions provided')
  for (const [id, question] of entries) {
    if (!question.instructions.trim()) throw new JevError(`question "${id}": instructions are required`)
    if (question.type === 'score' && question.criteria.length < 2) {
      throw new JevError(`question "${id}": score needs at least two levels`)
    }
  }
}

function normalizeResponse(value: unknown): JevResponse {
  if (value === null || typeof value !== 'object') throw new JevError('response was not an object')
  const answers = Reflect.get(value, 'answers')
  if (answers === null || typeof answers !== 'object') throw new JevError('response is missing the answers map')
  for (const [id, answer] of Object.entries(answers)) {
    if (!isJevAnswer(answer)) throw new JevError(`answer "${id}" has an unknown shape`)
  }
  const model = Reflect.get(value, 'model')
  const usage = Reflect.get(value, 'usage')
  return {
    model: typeof model === 'string' ? model : DEFAULT_MODEL,
    answers: answers as Record<string, JevAnswer>,
    ...(isUsage(usage) ? { usage } : {}),
  }
}

function isJevAnswer(value: unknown): value is JevAnswer {
  if (value === null || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  if (type === 'noul') {
    const noul = Reflect.get(value, 'noul')
    return typeof noul === 'number' && Number.isFinite(noul)
  }
  if (type === 'score') {
    const score = Reflect.get(value, 'score')
    const confidence = Reflect.get(value, 'confidence')
    return typeof score === 'number' && Number.isFinite(score)
      && (confidence === undefined || (typeof confidence === 'number' && Number.isFinite(confidence)))
  }
  return false
}

function isUsage(value: unknown): value is NonNullable<JevResponse['usage']> {
  if (value === null || typeof value !== 'object') return false
  const input = Reflect.get(value, 'input_tokens')
  const output = Reflect.get(value, 'output_tokens')
  return (input === undefined || typeof input === 'number')
    && (output === undefined || typeof output === 'number')
}

function asJevError(error: unknown): JevError {
  if (error instanceof JevError) return error
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new JevError(error.message || 'request timed out', undefined, true)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new JevError(error.message || 'request aborted', undefined, false)
  }
  return new JevError(error instanceof Error ? error.message : String(error), undefined, true)
}

function statusHint(status: number): string {
  switch (status) {
    case 401: return ' (missing or invalid API key)'
    case 422: return ' (request body failed validation)'
    case 429: return ' (rate limited)'
    case 529: return ' (overloaded)'
    default: return ''
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}
