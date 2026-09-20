/**
 * Wire vocabulary for the `jev/report` Remote endpoint: the account-usage
 * report the browser sidebar card renders.
 *
 * The report deliberately splits into two layers, because TypeSafe/Jev's
 * public HTTP API has no dedicated quota endpoint — only the per-request
 * `usage` token counts on each SystemOne response:
 *
 * - `local`: facts the plugin itself accumulates on the Host (review call
 *   counts, allow/deny tallies, token spend). Always present once the plugin
 *   has run; zero when nothing has been reviewed yet.
 * - `account`: facts pulled from an account-usage HTTP endpoint (`GET
 *   <usageEndpoint>`, same Bearer key). `null` when the endpoint is not
 *   configured, disabled, or returned an error — the browser renders the
 *   local layer alone in that case. The response body shape is not frozen by
 *   a public spec, so decoding here is deliberately permissive: every field
 *   is probed under several common aliases and omitted when absent.
 *
 * This file imports only types and the dependency-free validator factory, so
 * the browser bundle inlines it whole (no Host module ever crosses the wire).
 *
 * @module dsh-auto-review-jev/usage-wire
 */

import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { makeBoundaryValidator, makeRemoteDescriptor, REMOTE_PACKAGE } from './wire-shared.ts'

/** The slash-joined endpoint name every side of the report Remote uses. */
export const REPORT_ENDPOINT = 'jev/report' as const

/** Locally accumulated usage facts (Host-side counters). */
export interface JevLocalUsage {
  /** Total SystemOne evaluation calls made by the reviewer. */
  calls: number
  /** Calls that produced an allow decision. */
  allowed: number
  /** Calls that produced a deny decision. */
  denied: number
  /** Calls that failed (network/HTTP/parse) and failed closed. */
  failed: number
  /** Sum of `usage.input_tokens` across successful responses. */
  inputTokens: number
  /** Sum of `usage.output_tokens` across successful responses. */
  outputTokens: number
  /** Millis timestamp of the first recorded call; 0 when none. */
  since: number
  /** Millis timestamp of the most recent recorded call; 0 when none. */
  lastCallAt: number
}

/**
 * Best-effort decode of the configured account-usage endpoint's body. All
 * fields are optional; the UI renders whatever subset arrives.
 */
export interface JevAccountUsage {
  /** Account or organization display name, when the endpoint reports one. */
  name?: string
  /** Plan / tier label, when reported. */
  plan?: string
  /** Granted credit balance (currency-neutral units), when reported. */
  balance?: number
  /** Credit limit / monthly cap, when reported. */
  limit?: number
  /** Credits consumed in the current period, when reported. */
  used?: number
  /** Credits remaining in the current period, when reported. */
  remaining?: number
  /** Token quota for the current period, when reported. */
  tokenLimit?: number
  /** Tokens consumed in the current period, when reported. */
  tokenUsed?: number
  /** Currency code for the credit fields (e.g. `USD`), when reported. */
  currency?: string
  /** Millis timestamp at which the current period resets; 0 when unknown. */
  resetsAt?: number
}

/** The full report payload `jev/report` returns. */
export interface JevUsageReport {
  /** Whether an API key is configured (drives the browser's empty state). */
  configured: boolean
  /** The effective evaluation endpoint (never the key itself). */
  endpoint: string
  /** The effective account-usage endpoint, '' when disabled/unset. */
  usageEndpoint: string
  /** The configured model id. */
  model: string
  /** Locally accumulated counters. */
  local: JevLocalUsage
  /**
   * Account-side facts, or `null` when no usage endpoint is configured or
   * the last fetch failed (see `accountError`).
   */
  account: JevAccountUsage | null
  /** Last account-fetch failure message, '' when healthy or never fetched. */
  accountError: string
  /** Millis timestamp of the last successful account fetch; 0 when none. */
  accountFetchedAt: number
}

// ---------------------------------------------------------------------------
// Boundary validation (shared by the Host descriptor and the client mount)
// ---------------------------------------------------------------------------

const { reject, record, stringField, numberField, booleanField } =
  makeBoundaryValidator('jev/report result:')

function optionalString(source: Record<string, unknown>, key: string, field: string): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : reject(field)
}

function optionalNumber(source: Record<string, unknown>, key: string, field: string): number | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : reject(field)
}

function parseLocal(value: unknown): JevLocalUsage {
  const source = record(value, 'local')
  return {
    calls: numberField(source, 'calls', 'local.calls'),
    allowed: numberField(source, 'allowed', 'local.allowed'),
    denied: numberField(source, 'denied', 'local.denied'),
    failed: numberField(source, 'failed', 'local.failed'),
    inputTokens: numberField(source, 'inputTokens', 'local.inputTokens'),
    outputTokens: numberField(source, 'outputTokens', 'local.outputTokens'),
    since: numberField(source, 'since', 'local.since'),
    lastCallAt: numberField(source, 'lastCallAt', 'local.lastCallAt'),
  }
}

function parseAccount(value: unknown): JevAccountUsage | null {
  if (value === null) return null
  const source = record(value, 'account')
  const out: JevAccountUsage = {}
  const name = optionalString(source, 'name', 'account.name')
  const plan = optionalString(source, 'plan', 'account.plan')
  const balance = optionalNumber(source, 'balance', 'account.balance')
  const limit = optionalNumber(source, 'limit', 'account.limit')
  const used = optionalNumber(source, 'used', 'account.used')
  const remaining = optionalNumber(source, 'remaining', 'account.remaining')
  const tokenLimit = optionalNumber(source, 'tokenLimit', 'account.tokenLimit')
  const tokenUsed = optionalNumber(source, 'tokenUsed', 'account.tokenUsed')
  const currency = optionalString(source, 'currency', 'account.currency')
  const resetsAt = optionalNumber(source, 'resetsAt', 'account.resetsAt')
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

/**
 * Validate one `jev/report` result arriving from either wire direction.
 * Throws TypeError naming the offending field on any violation.
 */
export function parseReportResult(value: unknown): JevUsageReport {
  const source = record(value, 'root')
  return {
    configured: booleanField(source, 'configured', 'configured'),
    endpoint: stringField(source, 'endpoint', 'endpoint'),
    usageEndpoint: stringField(source, 'usageEndpoint', 'usageEndpoint'),
    model: stringField(source, 'model', 'model'),
    local: parseLocal(source.local),
    account: parseAccount(source.account),
    accountError: stringField(source, 'accountError', 'accountError'),
    accountFetchedAt: numberField(source, 'accountFetchedAt', 'accountFetchedAt'),
  }
}

/** The strict invocation descriptor both Typert generations register. */
export const reportDescriptor = makeRemoteDescriptor<JevUsageReport>(
  REPORT_ENDPOINT,
  'report',
  `${REMOTE_PACKAGE}#JevUsageReport`,
  { parse: parseReportResult },
)

/** The Host-face contribution registered on `ctx.typert`. */
export const USAGE_HOST_CONTRIBUTION = {
  package: REMOTE_PACKAGE,
  face: 'host' as const,
  schemas: [],
  // 0.1.2's Typert registry requires every Host contribution to carry its
  // reflection model. This hand-written Remote deliberately has no generated
  // reflection exports, so use the official empty-model form rather than a
  // cast that leaves registry inspection with `model: undefined`.
  model: { services: [], events: [], objects: [] },
  invocations: [reportDescriptor],
}

/** The Client-face contribution mounted on `ctx.remote`. */
export const USAGE_REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: REMOTE_PACKAGE,
  descriptors: [reportDescriptor],
}
