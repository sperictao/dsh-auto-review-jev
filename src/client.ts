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

async function postOnce(endpoint: string, body: string, call: JevCall): Promise<JevResponse> {
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
