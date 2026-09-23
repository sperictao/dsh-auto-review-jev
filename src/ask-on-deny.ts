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
 * The dialog speaks the language the Web UI is rendering in (pushed by the
 * browser half over `jev/locale`, see {@link DenialLocale}) and states what was
 * reviewed and why it was refused: the verdict, the dimensions that fired with
 * their scores, the tool and the call about to run. A person deciding whether
 * to override a security judgment needs the judgment itself, not just its
 * conclusion.
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

/** Stable question id, so an answer can be matched even if several are pending. */
export const QUESTION_ID = 'jev-auto-review-denied'

/** The languages the reprieve copy ships in. */
export type DenialLocale = 'zh' | 'en'

/**
 * Map the browser's locale id onto a shipped language.
 *
 * Anything that is not Chinese falls back to English, which is also the
 * fallback DSH itself uses for a browser that names no registered language and
 * for non-browser runs.
 *
 * @param active - locale id the browser reported, or undefined when it never did.
 */
export function denialLocale(active: string | undefined): DenialLocale {
  return (active ?? '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * What the human is being asked to override.
 *
 * Everything here is a fact about the pending call and the verdict that
 * refused it; the wording belongs to {@link DENIAL_COPY}, so the two can be
 * translated without touching the review logic.
 */
export interface DenialFacts {
  /** The reviewed tool's name. */
  readonly toolName: string
  /** The call about to run, already rendered and truncated by the caller. */
  readonly call?: string
  /** The verdict's risk level (`low`/`medium`/`high`); absent when the review failed. */
  readonly risk?: string
  /** Raw dimension entries from the verdict, e.g. `external_write=0.88`. */
  readonly reasons?: readonly string[]
  /** The failure text when the reviewer could not decide. */
  readonly error?: string
}

/** Localized copy for one language. */
export interface DenialCopy {
  /** Question title. */
  readonly header: string
  /** The question itself, naming the tool. */
  readonly question: (toolName: string) => string
  /** The option that grants this one call. */
  readonly allow: DenialOption
  /** The option that keeps Jev's denial. */
  readonly keep: DenialOption
  /** The review's own findings, rendered for this language. */
  readonly detail: (facts: DenialFacts) => string
}

/** Names of the review dimensions, so a person can read what fired. */
const DIMENSION_LABELS: Record<DenialLocale, Record<string, string>> = {
  zh: {
    sensitive_exfiltration: '敏感数据外泄',
    destructive: '破坏性操作',
    production_effect: '影响生产环境',
    external_write: '外部写入',
    security_change: '安全相关变更',
    beyond_scope: '超出授权范围',
    explicit_authorization: '显式授权',
    authorization_conflict: '授权冲突',
    session_created_cleanup: '会话内清理',
    impact: '影响程度',
  },
  en: {
    sensitive_exfiltration: 'sensitive data exfiltration',
    destructive: 'destructive',
    production_effect: 'production effect',
    external_write: 'external write',
    security_change: 'security change',
    beyond_scope: 'beyond scope',
    explicit_authorization: 'explicit authorization',
    authorization_conflict: 'authorization conflict',
    session_created_cleanup: 'session-created cleanup',
    impact: 'impact',
  },
}

const RISK_LABELS: Record<DenialLocale, Record<string, string>> = {
  zh: { low: '低风险', medium: '中风险', high: '高风险' },
  en: { low: 'low risk', medium: 'medium risk', high: 'high risk' },
}

/**
 * Render one verdict entry (`external_write=0.88`, `impact=2.5/3`) as a label
 * and a score. An unknown dimension keeps its raw id rather than vanishing: a
 * verdict that fires should never be silent in the dialog.
 */
function dimensionEntry(locale: DenialLocale, entry: string): string {
  const separator = entry.indexOf('=')
  if (separator < 0) return entry
  const id = entry.slice(0, separator)
  const value = entry.slice(separator + 1)
  return `${DIMENSION_LABELS[locale][id] ?? id} ${value}`
}

function renderDetail(locale: DenialLocale, facts: DenialFacts): string {
  const lines: string[] = []
  const separator = locale === 'zh' ? '、' : ', '
  if (facts.error !== undefined) {
    lines.push(locale === 'zh' ? `审查未能完成：${facts.error}` : `Review could not complete: ${facts.error}`)
  } else if (facts.risk !== undefined) {
    const risk = RISK_LABELS[locale][facts.risk] ?? facts.risk
    lines.push(locale === 'zh' ? `审查结论：${risk}，已拒绝` : `Verdict: ${risk}, denied`)
  }
  const reasons = facts.reasons ?? []
  if (reasons.length > 0) {
    const rendered = reasons.map(entry => dimensionEntry(locale, entry)).join(separator)
    lines.push(locale === 'zh' ? `触发维度：${rendered}` : `Triggered: ${rendered}`)
  }
  lines.push(locale === 'zh' ? `工具：${facts.toolName}` : `Tool: ${facts.toolName}`)
  if (facts.call !== undefined && facts.call !== '') {
    lines.push(locale === 'zh' ? `调用参数：${facts.call}` : `Call: ${facts.call}`)
  }
  return lines.join('\n')
}

/** Every string the reprieve dialog can show, per language. */
export const DENIAL_COPY: Record<DenialLocale, DenialCopy> = {
  zh: {
    header: 'Auto Review Jev',
    question: toolName => `Jev 拒绝执行工具 "${toolName}"，是否允许这一次调用照常执行？`,
    allow: {
      label: '允许本次执行',
      description: '只放行这一次调用；后续调用仍由 Jev 审查。',
    },
    keep: {
      label: '保持拒绝',
      description: '维持 Jev 的拒绝，工具不会执行。',
    },
    detail: facts => renderDetail('zh', facts),
  },
  en: {
    header: 'Auto Review Jev',
    question: toolName => `Jev denied tool "${toolName}". Allow this one call to run anyway?`,
    allow: {
      label: 'Allow once',
      description: 'Runs this one call; later calls are still reviewed.',
    },
    keep: {
      label: 'Keep denied',
      description: 'Keeps the denial; the tool does not run.',
    },
    detail: facts => renderDetail('en', facts),
  },
}

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
  /** What was reviewed and why it was refused. */
  readonly facts: DenialFacts
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
  /**
   * The language the Web UI is rendering in, read per ask. Absent (or an
   * unknown id) means English — the same fallback DSH uses for non-browser runs.
   */
  readonly locale?: () => string | undefined
}

/**
 * Build the question for one denied call, in the language the UI is using.
 *
 * `detail` carries the review's own findings (verdict, dimensions and scores,
 * the tool, the call), which capable UIs render under the question.
 *
 * @param locale - the language to write in.
 * @param facts - what was reviewed and why it was refused.
 * @returns the question to ask.
 */
export function denialQuestion(locale: DenialLocale, facts: DenialFacts): DenialQuestion {
  const copy = DENIAL_COPY[locale]
  return {
    id: QUESTION_ID,
    header: copy.header,
    question: copy.question(facts.toolName),
    detail: copy.detail(facts),
    options: [copy.allow, copy.keep],
  }
}

/**
 * Whether an answer grants this call.
 *
 * Only the allow label this question actually offered, or a free-text answer
 * from the closed allow vocabulary, counts. The label is a parameter because it
 * is written in the language the question was asked in, and labels are the
 * answer encoding. Everything else — no answer, an unknown selection, an
 * unrelated free text — keeps the denial.
 *
 * @param answer - the answer item for this question, when the UI sent one.
 * @param allowLabel - the allow option's label in the language that was asked.
 * @returns true only for a recognisable allow.
 */
export function answerAllows(answer: DenialAnswer | undefined, allowLabel: string): boolean {
  if (answer === undefined) return false
  if ((answer.selected ?? []).includes(allowLabel)) return true
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
    // The accessor must never escape as a throw: this runs inside the
    // pre-execute hook, where an escaping exception replaces a clean,
    // self-explaining denial with a raw service error. Cordis guards service
    // properties behind an inject, so a raw `ctx.userQuestions` access throws
    // "cannot get property … without inject" exactly here.
    let seam: UserQuestionsSeam | undefined
    try {
      seam = deps.seam()
    } catch (error) {
      return { kind: 'error', error }
    }
    if (seam === undefined) {
      warnOnce('no `userQuestions` service is loaded, so a denied call cannot ask the user')
      return { kind: 'unavailable' }
    }
    const locale = denialLocale(deps.locale?.())
    const question = denialQuestion(locale, input.facts)
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
    return answerAllows(answer, DENIAL_COPY[locale].allow.label) ? { kind: 'allow' } : { kind: 'denied' }
  }

  const guarded = async (input: DenialAskInput): Promise<DenialAskResult> => {
    try {
      return await askOnce(input)
    } catch (error) {
      // Last-resort fail closed: `ask()` must always RESOLVE to a decision and
      // never reject, so the pre-execute hook can only ever deny cleanly — a
      // malformed answer payload (e.g. `answers` not an array) must not escape
      // as a raw TypeError in place of the denial.
      return { kind: 'error', error }
    }
  }

  return {
    ask: (input) => {
      const key = input.queueKey
      if (key === undefined) return guarded(input)
      const previous = queues.get(key) ?? Promise.resolve()
      const next = previous.then(
        () => guarded(input),
        () => guarded(input),
      )
      queues.set(
        key,
        next.catch(() => undefined),
      )
      return next
    },
  }
}
