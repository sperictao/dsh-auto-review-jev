/**
 * Human reprieve for a denied call.
 *
 * Jev's verdict is final by design, which means a denial stops a turn with no
 * way for the human — the authority Jev itself defers to — to answer "run it
 * anyway". This module asks that human through DSH's user-questions seam
 * (`ctx.userQuestions`, the seam behind the model's `ask_user_question` tool)
 * and reports whether the denial may be lifted for exactly this one call.
 *
 * Why not return `{ kind: 'ask' }` from the pre-execute hook? That decision
 * routes through `ctx.approval`, whose `decide()` answers `'rejected'`
 * immediately while the session's policy is `never` — precisely the policy the
 * Auto preset pairs with Full access. The reprieve therefore has to be asked
 * for directly. The answer still covers ONE call: a grant is never remembered
 * and never widens a later decision.
 *
 * Fail closed on every path: a missing or unavailable answerer (no UI mounted,
 * a subagent's call, a throwing seam) keeps the denial, and so does an answer
 * that is not recognisably an allow. `keepDeniedNote()` turns each of those
 * into the transcript suffix that explains why the call stayed blocked.
 *
 * @module @dsh-external/dsh-auto-review-jev/ask-on-deny
 */

/** One option the human can pick. Labels are the answer encoding, so they are exported constants. */
export interface DenialOption {
  /** Exactly what the answerer echoes back when this option is picked. */
  readonly label: string
  /** One sentence explaining the consequence. */
  readonly description: string
}

/** The single question this module asks about one denied call. */
export interface DenialQuestion {
  /** Stable id, echoed in the answer. */
  readonly id: string
  readonly header: string
  /** The question itself, kept free of the denial text (that rides in `detail`). */
  readonly question: string
  /** The original denial, which the UI renders with the question. */
  readonly detail: string
  readonly options: readonly DenialOption[]
}

/** The subset of the `ctx.userQuestions` service this module consumes. */
export interface UserQuestionsSeam {
  ask(request: {
    questions: DenialQuestion[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{ answers: readonly { id: string; selected: readonly string[]; custom?: string }[] }>
}

/** One answer item, as the answerer returns it. */
export interface DenialAnswer {
  readonly selected?: readonly string[]
  readonly custom?: string
}

/** The option that grants this one call. */
export const ALLOW_LABEL = '允许本次执行 (Allow once)'
/** The option that keeps Jev's denial. */
export const KEEP_DENIED_LABEL = '保持拒绝 (Keep denied)'
/** Stable question id, so an answer can be matched even if several are pending. */
export const QUESTION_ID = 'jev-auto-review-denied'

/**
 * Free-text answers that still count as an allow.
 *
 * The seam lets a UI send an "Other" string instead of a label, so the grant
 * path has to recognise one. Recognition is a closed vocabulary rather than a
 * fuzzy match: anything not listed here keeps the denial.
 */
const ALLOW_WORDS: ReadonlySet<string> = new Set([
  'allow',
  'allow once',
  'yes',
  'y',
  'ok',
  'okay',
  'run it',
  'execute',
  '允许',
  '同意',
  '允许执行',
  '允许本次',
  '允许本次执行',
  '可以',
  '是',
  '执行',
])

/** What one ask attempt decided. Only `allow` lifts the denial. */
export type DenialAskResult =
  | { readonly kind: 'allow' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'error'; readonly error: unknown }

/** One ask request: everything the question needs plus the serialization key. */
export interface DenialAskInput {
  /** The reviewed tool's name. */
  readonly toolName: string
  /** The original denial text, as it would have been shown. */
  readonly denialText: string
  /** The call's own cancellation lifetime. */
  readonly signal: AbortSignal
  /** The calling agent, forwarded so the UI can answer on its behalf. */
  readonly agent?: unknown
  /** Serialization key (pass the agent): one prompt at a time per distinct key. */
  readonly queueKey?: object
}

/** The asker the pre-execute hook calls before a denial becomes final. */
export interface DenialAsker {
  ask(input: DenialAskInput): Promise<DenialAskResult>
}

export interface DenialAskerDeps {
  /** Resolves the seam lazily: injection order settles only after this plugin loads. */
  readonly seam: () => UserQuestionsSeam | undefined
  /** Reported once per plugin instance when no answerer can be reached. */
  readonly warn: (message: string) => void
}

/**
 * Build the question for one denied call.
 *
 * The copy is bilingual on purpose: the host side of DSH has no locale seam
 * (only the browser half has one), so a fixed pair of languages serves both
 * audiences better than picking one. The original denial rides in `detail`,
 * which capable UIs render next to the question.
 *
 * @param toolName - the reviewed tool's name.
 * @param denialText - the denial exactly as the transcript would show it.
 * @returns the question to ask.
 */
export function denialQuestion(toolName: string, denialText: string): DenialQuestion {
  return {
    id: QUESTION_ID,
    header: 'Auto Review Jev',
    question: `Jev 拒绝执行工具 "${toolName}"，是否允许这一次调用照常执行？ / Jev denied tool "${toolName}". Allow this one call to run anyway?`,
    detail: `原始拒绝 / Original denial: ${denialText}`,
    options: [
      {
        label: ALLOW_LABEL,
        description:
          '只放行这一次调用；后续调用仍由 Jev 审查。 / Runs this one call; later calls are still reviewed.',
      },
      {
        label: KEEP_DENIED_LABEL,
        description: '维持 Jev 的拒绝，工具不会执行。 / Keeps the denial; the tool does not run.',
      },
    ],
  }
}

/**
 * Whether an answer grants this call.
 *
 * Only the allow label, or a free-text answer from the closed allow vocabulary,
 * counts. Everything else — no answer, an unknown selection, an unrelated free
 * text — keeps the denial.
 *
 * @param answer - the answer item for this question, when the UI sent one.
 * @returns true only for a recognisable allow.
 */
export function answerAllows(answer: DenialAnswer | undefined): boolean {
  if (answer === undefined) return false
  if ((answer.selected ?? []).includes(ALLOW_LABEL)) return true
  const custom = (answer.custom ?? '').trim().toLowerCase()
  return custom !== '' && ALLOW_WORDS.has(custom)
}

/**
 * The transcript suffix explaining why a call stayed denied.
 *
 * @param result - the ask outcome; the `error` arm's message is added by the caller, which owns key redaction.
 * @returns the suffix, or an empty string for a grant.
 */
export function keepDeniedNote(result: DenialAskResult): string {
  switch (result.kind) {
    case 'allow':
      return ''
    case 'denied':
      return 'the user was asked and kept the denial'
    case 'unavailable':
      return 'no user-questions answerer is available to ask, so the denial stands'
    case 'aborted':
      return 'the call was aborted while the user was being asked'
    case 'error':
      return 'the user could not be asked'
  }
}

/** Recognize the seam's "nobody accepted this request" failure. */
function isNoAnswerer(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'NO_PROVIDER'
}

/**
 * Create the asker used before a denial becomes final.
 *
 * Prompts are serialized per `queueKey`: parallel tool calls in one model step
 * would otherwise stack several questions at once, which is worse for the
 * human than answering them one after another. Distinct keys never wait on
 * each other, so one session's pending question cannot hide another's.
 *
 * @param deps - lazy seam access plus the plugin's warning sink.
 * @returns an asker bound to those dependencies.
 */
export function createDenialAsker(deps: DenialAskerDeps): DenialAsker {
  const queues = new WeakMap<object, Promise<unknown>>()
  let warned = false

  const warnOnce = (message: string): void => {
    if (warned) return
    warned = true
    deps.warn(message)
  }

  const askOnce = async (input: DenialAskInput): Promise<DenialAskResult> => {
    if (input.signal.aborted) return { kind: 'aborted' }
    const seam = deps.seam()
    if (seam === undefined) {
      warnOnce('no `userQuestions` service is loaded, so a denied call cannot ask the user')
      return { kind: 'unavailable' }
    }
    const question = denialQuestion(input.toolName, input.denialText)
    const request: { questions: DenialQuestion[]; agent?: unknown; signal?: AbortSignal } = {
      questions: [question],
      signal: input.signal,
    }
    if (input.agent !== undefined) request.agent = input.agent
    let answers: readonly { id: string; selected: readonly string[]; custom?: string }[]
    try {
      answers = (await seam.ask(request)).answers
    } catch (error) {
      if (input.signal.aborted) return { kind: 'aborted' }
      if (isNoAnswerer(error)) {
        warnOnce('no user-questions answerer accepted the request, so a denied call cannot ask the user')
        return { kind: 'unavailable' }
      }
      return { kind: 'error', error }
    }
    const answer = answers.find((item) => item.id === question.id) ?? answers[0]
    return answerAllows(answer) ? { kind: 'allow' } : { kind: 'denied' }
  }

  return {
    ask: (input) => {
      const key = input.queueKey
      if (key === undefined) return askOnce(input)
      const previous = queues.get(key) ?? Promise.resolve()
      const next = previous.then(
        () => askOnce(input),
        () => askOnce(input),
      )
      queues.set(
        key,
        next.catch(() => undefined),
      )
      return next
    },
  }
}
