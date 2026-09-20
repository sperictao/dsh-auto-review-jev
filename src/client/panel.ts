/**
 * View-model builder for the quota panel. Turns the raw `jev/report` payload
 * plus the fetch lifecycle into the flat display shape both React surfaces
 * (sidebar footer card, center dashboard) render — no fact is derived in the
 * components themselves.
 *
 * Pure and dependency-free, so node tests drive the whole projection.
 *
 * @module dsh-auto-review-jev/client/panel
 */

import type { UsagePageState } from './usage.ts'
import { formatCredits, formatTimestamp, formatTokensCompact, quotaRatio } from './usage.ts'
import type { PanelKey } from './panel-copy.ts'

/** One rendered quota bar (credit or token window). */
export interface PanelBarView {
  /** Locale key for the bar's label. */
  label: PanelKey
  /** `used / limit` display pair; '' when unknown. */
  value: string
  /** `xx%` display string; '' when uncapped/unknown. */
  percent: string
  /** Bar fill in [0, 100]; 0 when unknown. */
  barPercent: number
  /** True when the bar is at or past its cap. */
  exhausted: boolean
}

/** One labelled figure tile. */
export interface PanelStatView {
  label: PanelKey
  value: string
}

/** The complete panel projection. */
export interface PanelView {
  text: Record<PanelKey, string>
  loading: boolean
  /** True when no API key is configured at all (empty state). */
  noKey: boolean
  /** Hard failure face (Remote refused); detail is the raw message. */
  failure: { title: PanelKey; detail: string } | undefined
  /** Account-side snapshot exists (drives which sections render). */
  hasAccount: boolean
  accountName: string
  plan: string
  /** Credit quota bar, when the account snapshot carries the pair. */
  creditBar: PanelBarView | undefined
  /** Token quota bar, when the account snapshot carries the pair. */
  tokenBar: PanelBarView | undefined
  /** Balance line; '' when unreported. */
  balance: string
  /** Remaining-credit line; '' when unreported. */
  remaining: string
  resetsAt: string
  /** Account-fetch failure (stale snapshot retained); '' when healthy. */
  accountError: string
  /** True when no usage endpoint is configured (local-only mode). */
  localOnly: boolean
  /** The local-counter tiles. */
  local: PanelStatView[]
  /** Footer card headline: the bar the ring tracks (credit first, then tokens). */
  headline: PanelBarView | undefined
  /** 'Updated HH:MM' suffix source; '' when never fetched. */
  updatedAt: string
}

function creditBarOf(used: number | undefined, limit: number | undefined, currency: string | undefined): PanelBarView | undefined {
  const ratio = quotaRatio(used, limit)
  if (used === undefined && limit === undefined) return undefined
  const value = used !== undefined && limit !== undefined
    ? `${formatCredits(used, currency)} / ${formatCredits(limit, currency)}`
    : limit !== undefined ? formatCredits(limit, currency) : ''
  return {
    label: 'monthly',
    value,
    percent: ratio === undefined ? '' : `${Math.round(ratio * 100)}%`,
    barPercent: ratio === undefined ? 0 : ratio * 100,
    exhausted: ratio !== undefined && ratio >= 1,
  }
}

function tokenBarOf(used: number | undefined, limit: number | undefined): PanelBarView | undefined {
  const ratio = quotaRatio(used, limit)
  if (used === undefined && limit === undefined) return undefined
  const value = used !== undefined && limit !== undefined
    ? `${formatTokensCompact(used)} / ${formatTokensCompact(limit)}`
    : limit !== undefined ? formatTokensCompact(limit) : ''
  return {
    label: 'tokenQuota',
    value,
    percent: ratio === undefined ? '' : `${Math.round(ratio * 100)}%`,
    barPercent: ratio === undefined ? 0 : ratio * 100,
    exhausted: ratio !== undefined && ratio >= 1,
  }
}

/** Project the panel's full view from the controller snapshot. */
export function buildPanelView(options: {
  usage: UsagePageState
  t: Record<PanelKey, string>
}): PanelView {
  const { usage, t } = options
  const report = usage.report
  const account = report?.account ?? null
  const local = report?.local

  const failure = usage.status === 'error'
    ? { title: 'errorTitle' as PanelKey, detail: usage.error ?? '' }
    : undefined

  const creditBar = account === null ? undefined : creditBarOf(account.used, account.limit, account.currency)
  const tokenBar = account === null ? undefined : tokenBarOf(account.tokenUsed, account.tokenLimit)

  return {
    text: t,
    loading: usage.status === 'loading',
    noKey: report !== undefined && !report.configured,
    failure,
    hasAccount: account !== null,
    accountName: account?.name ?? '',
    plan: account?.plan ?? '',
    creditBar,
    tokenBar,
    balance: account?.balance === undefined ? '' : formatCredits(account.balance, account.currency),
    remaining: account?.remaining === undefined ? '' : formatCredits(account.remaining, account.currency),
    resetsAt: account?.resetsAt === undefined ? '' : formatTimestamp(account.resetsAt),
    accountError: report?.accountError ?? '',
    localOnly: report !== undefined && report.usageEndpoint === '',
    local: local === undefined ? [] : [
      { label: 'localCalls', value: String(local.calls) },
      { label: 'localAllowed', value: String(local.allowed) },
      { label: 'localDenied', value: String(local.denied) },
      { label: 'localFailed', value: String(local.failed) },
      { label: 'localTokens', value: `${formatTokensCompact(local.inputTokens)} / ${formatTokensCompact(local.outputTokens)}` },
    ],
    headline: creditBar ?? tokenBar,
    updatedAt: usage.fetchedAt === undefined ? '' : formatTimestamp(usage.fetchedAt),
  }
}
