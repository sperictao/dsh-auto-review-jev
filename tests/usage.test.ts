import { describe, expect, it, vi } from 'vitest'
import { fetchAccountUsage, JevError } from '../src/client.ts'
import { parseReportResult, REPORT_ENDPOINT, reportDescriptor, USAGE_REMOTE_CONTRIBUTION } from '../src/usage-wire.ts'
import type { JevUsageReport } from '../src/usage-wire.ts'
import { buildPanelView } from '../src/client/panel.ts'
import { formatCredits, formatTokensCompact, quotaRatio } from '../src/client/usage.ts'
import { panelTextEN } from '../src/client/panel-copy.ts'
import type { UsagePageState } from '../src/client/usage.ts'

const usageState = (report: JevUsageReport | undefined, status: UsagePageState['status'] = 'ready'): UsagePageState => ({
  status,
  report,
  error: undefined,
  fetchedAt: report === undefined ? undefined : 1_700_000_000_000,
})

const baseReport = (overrides: Partial<JevUsageReport> = {}): JevUsageReport => ({
  configured: true,
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  usageEndpoint: 'https://api.typesafe.ai/v1/usage',
  model: 'jev-latest',
  local: {
    calls: 12,
    allowed: 9,
    denied: 2,
    failed: 1,
    inputTokens: 48_200,
    outputTokens: 1_900,
    since: 1_700_000_000_000,
    lastCallAt: 1_700_000_100_000,
  },
  account: null,
  accountError: '',
  accountFetchedAt: 0,
  ...overrides,
})

describe('parseReportResult', () => {
  it('round-trips a full report', () => {
    const report = baseReport({
      account: { name: 'Eric', plan: 'pro', used: 1.32, limit: 6, remaining: 4.68, currency: 'USD', resetsAt: 1_700_100_000_000 },
      accountFetchedAt: 1_700_000_100_000,
    })
    expect(parseReportResult(JSON.parse(JSON.stringify(report)))).toEqual(report)
  })

  it('accepts a null account (usage endpoint unset)', () => {
    const report = baseReport({ usageEndpoint: '', account: null })
    expect(parseReportResult(report).account).toBeNull()
  })

  it('rejects a missing local counter', () => {
    const bad = baseReport()
    // @ts-expect-error deliberately broken wire payload
    bad.local = { ...bad.local, calls: 'twelve' }
    expect(() => parseReportResult(bad)).toThrow(/local\.calls/)
  })

  it('rejects a non-boolean configured flag', () => {
    const bad = baseReport()
    // @ts-expect-error deliberately broken wire payload
    bad.configured = 'yes'
    expect(() => parseReportResult(bad)).toThrow(/configured/)
  })

  it('rejects unknown account field types instead of passing them through', () => {
    const report = baseReport({ account: { used: 'lots' } as never })
    expect(() => parseReportResult(report)).toThrow(/account\.used/)
  })
})

describe('descriptor wiring', () => {
  it('names the shared endpoint and the jevUsage service', () => {
    expect(REPORT_ENDPOINT).toBe('jev/report')
    expect(reportDescriptor.service).toBe('jevUsage')
    expect(reportDescriptor.namespace).toBe('jev')
    expect(reportDescriptor.method).toBe('report')
  })

  it('ships the client contribution for the same endpoint', () => {
    expect(USAGE_REMOTE_CONTRIBUTION.package).toBe('dsh-auto-review-jev')
    expect(USAGE_REMOTE_CONTRIBUTION.descriptors.map((d) => d.id)).toEqual([reportDescriptor.id])
  })
})

describe('fetchAccountUsage', () => {
  it('decodes a flat usage body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      balance: 10.5,
      plan: 'pro',
      used: 1.25,
      limit: 6,
      resets_at: '2026-10-01T00:00:00Z',
    }), { status: 200 })))
    const usage = await fetchAccountUsage({ apiKey: 'k', usageEndpoint: 'https://example.test/v1/usage' })
    expect(usage.plan).toBe('pro')
    expect(usage.balance).toBe(10.5)
    expect(usage.used).toBe(1.25)
    expect(usage.resetsAt).toBe(Date.parse('2026-10-01T00:00:00Z'))
  })

  it('unwraps a nested envelope and reads snake_case aliases', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { account_name: 'team', monthly_limit: 20, token_used: 123456, currency: 'USD' },
    }), { status: 200 })))
    const usage = await fetchAccountUsage({ apiKey: 'k', usageEndpoint: 'https://example.test/v1/usage' })
    expect(usage.name).toBe('team')
    expect(usage.limit).toBe(20)
    expect(usage.tokenUsed).toBe(123456)
    expect(usage.currency).toBe('USD')
  })

  it('converts epoch-seconds reset timestamps to millis', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ resets_at: 1_700_000_000 }), { status: 200 })))
    const usage = await fetchAccountUsage({ apiKey: 'k', usageEndpoint: 'https://example.test/v1/usage' })
    expect(usage.resetsAt).toBe(1_700_000_000_000)
  })

  it('throws JevError on a non-OK status with the body excerpt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(fetchAccountUsage({ apiKey: 'k', usageEndpoint: 'https://example.test/v1/usage' }))
      .rejects.toThrow(JevError)
  })

  it('sends the Bearer credential and GET', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await fetchAccountUsage({ apiKey: 'secret-key', usageEndpoint: 'https://example.test/v1/usage' })
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/v1/usage')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
  })
})

describe('formatting helpers', () => {
  it('formats token counts compactly', () => {
    expect(formatTokensCompact(999)).toBe('999')
    expect(formatTokensCompact(48_200)).toBe('48.2K')
    expect(formatTokensCompact(2_500_000)).toBe('2.5M')
  })

  it('formats credits with a currency hint', () => {
    expect(formatCredits(4.68, 'USD')).toBe('$4.68')
    expect(formatCredits(4.68, 'cny')).toBe('4.68 cny')
    expect(formatCredits(4.68, undefined)).toBe('4.68')
  })

  it('computes quota ratios with clamps', () => {
    expect(quotaRatio(3, 6)).toBe(0.5)
    expect(quotaRatio(9, 6)).toBe(1)
    expect(quotaRatio(undefined, 6)).toBeUndefined()
    expect(quotaRatio(3, 0)).toBeUndefined()
  })
})

describe('buildPanelView', () => {
  it('flags the no-key empty state', () => {
    const view = buildPanelView({ usage: usageState(baseReport({ configured: false })), t: panelTextEN })
    expect(view.noKey).toBe(true)
    expect(view.hasAccount).toBe(false)
  })

  it('projects the credit bar from the account snapshot', () => {
    const view = buildPanelView({
      usage: usageState(baseReport({ account: { used: 1.32, limit: 6, currency: 'USD', plan: 'pro' } })),
      t: panelTextEN,
    })
    expect(view.hasAccount).toBe(true)
    expect(view.creditBar?.value).toBe('$1.32 / $6.00')
    expect(view.creditBar?.percent).toBe('22%')
    expect(view.headline?.label).toBe('monthly')
  })

  it('marks local-only mode when no usage endpoint is configured', () => {
    const view = buildPanelView({ usage: usageState(baseReport({ usageEndpoint: '' })), t: panelTextEN })
    expect(view.localOnly).toBe(true)
    expect(view.headline).toBeUndefined()
  })

  it('projects local counters as tiles', () => {
    const view = buildPanelView({ usage: usageState(baseReport()), t: panelTextEN })
    const calls = view.local.find((stat) => stat.label === 'localCalls')
    const tokens = view.local.find((stat) => stat.label === 'localTokens')
    expect(calls?.value).toBe('12')
    expect(tokens?.value).toBe('48.2K / 1.9K')
  })

  it('surfaces a hard remote failure', () => {
    const view = buildPanelView({
      usage: { status: 'error', report: undefined, error: 'boom', fetchedAt: undefined },
      t: panelTextEN,
    })
    expect(view.failure?.title).toBe('errorTitle')
    expect(view.failure?.detail).toBe('boom')
  })
})
