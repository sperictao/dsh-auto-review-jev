/**
 * React components for the Jev quota panel (browser half): the sidebar
 * footer card and the dashboard it opens in the center column.
 *
 * Both render one {@link PanelView} projected by `./panel.ts` — no fact is
 * derived here. Strings arrive already localized in `view.text`: the
 * registrations declare the `panel.jev` locale namespace, so the renderer
 * hands these components a `t` seat.
 *
 * Styles ride the stylesheet `./panel-styles.ts` injects once; classes are
 * `jev-` prefixed.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/panel-view
 */

import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from './snapshot-store.ts'
import type { UsagePageState } from './usage.ts'
import { buildPanelView } from './panel.ts'
import type { PanelBarView, PanelStatView, PanelView } from './panel.ts'
import { panelTextEN } from './panel-copy.ts'
import type { PanelKey } from './panel-copy.ts'
// SlotMap merge for `main` / `sidebar.footer.action` (load-bearing: the slots
// this file's components register into are typed only by that augmentation).
import './panel-slots.ts'

/**
 * Owner share of the sidebar-foot action hole: the shell renders the foot
 * area and hands each action only the column fold state. There is no button
 * chrome and no `label` seat — the entry is the whole surface.
 */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * The injected face both panel slots carry. Bound by the client entry so the
 * components stay unaware of the controller, the layout service and the
 * auto-refresh loop.
 *
 * NOTE: the renderer destructures the `hooks` compartment OUT of this face
 * and re-exposes each member as a `use<Name>` prop (`jevUsage` →
 * `useJevUsage`). Read the `useX` seats, never `props.hooks.*`.
 */
export interface PanelInjected {
  hooks: {
    jevUsage: SnapshotStore<UsagePageState>
  }
  /** Fetch the report now (the dashboard's Refresh action). */
  refresh(): void
  /**
   * Leave the dashboard and show the Conversation again
   * (`ctx.layout.selectPanel(null)`; the current Session is untouched).
   */
  close(): void
  /** Start the shared background poll for this mount; returns its disposer. */
  startAutoRefresh(): () => void
  /** Select this panel in the center column (`ctx.layout.selectPanel`). */
  open(): void
}

/** The props a panel component actually receives. */
export interface PanelComponentProps {
  useJevUsage<T>(selector: (state: UsagePageState) => T): T
  /**
   * Locale seat for the `panel.jev` namespace, bound by the registration's
   * own `locale` declaration. Optional so a missing locale face degrades to
   * English instead of crashing the surface.
   */
  t?: Translate<PanelKey>
  refresh(): void
  close(): void
  startAutoRefresh(): () => void
  open(): void
}

/** Props of the sidebar footer card: the panel face plus the shell's fold state. */
export interface JevFooterEntryProps extends PanelComponentProps, SidebarFooterActionOwnerProps {}

/** The panel's view, recomputed on every notification. */
function usePanelView(props: PanelComponentProps): PanelView {
  const usage = props.useJevUsage((state) => state)
  const t = props.t ?? ((key: PanelKey) => panelTextEN[key] ?? key)
  const text = {} as Record<PanelKey, string>
  for (const key of Object.keys(panelTextEN) as PanelKey[]) text[key] = t(key)
  return buildPanelView({ usage, t: text })
}

/**
 * The quota ring. One glyph serves the rail button and the footer card's top
 * row: a faint track plus an arc whose sweep is the consumption, drawn from
 * 12 o'clock. Circumference 2πr = 45.55 at r = 7.25.
 */
function Ring({ percent, warn, size }: { percent: number; warn: boolean; size: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const circumference = 45.55
  const dashoffset = Math.round(circumference * (1 - clamped / 100) * 1000) / 1000
  return (
    <span className="jev-glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20" width={size} height={size} focusable="false">
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <circle
          cx="10"
          cy="10"
          r="7.25"
          fill="none"
          stroke={warn ? 'var(--dsw-alias-state-error-primary, #e5484d)' : 'currentColor'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={String(circumference)}
          strokeDashoffset={String(dashoffset)}
          transform="rotate(-90 10 10)"
        />
      </svg>
    </span>
  )
}

/** One labelled quota bar. */
function QuotaBar({ bar, text }: { bar: PanelBarView; text: (key: PanelKey) => string }) {
  const clamped = Math.min(100, Math.max(0, bar.barPercent))
  const label = text(bar.label)
  return (
    <div className="jev-window">
      <div className="jev-windowHead">
        <span className="jev-windowLabel">{label}</span>
        {bar.value !== '' ? <span className="jev-windowValue">{bar.value}</span> : null}
        {bar.percent !== '' ? <span className="jev-windowPct">{bar.percent}</span> : null}
      </div>
      <div className="jev-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
        <div className={bar.exhausted ? 'jev-barFill jev-barFillWarn' : 'jev-barFill'} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

/** A labelled figure tile. */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="jev-tile">
      <span className="jev-tileLabel">{label}</span>
      <span className="jev-tileValue">{value}</span>
    </div>
  )
}

/**
 * The center-column dashboard, registered into the layout's keyed `main`
 * slot under the same id the footer card selects, so the two are one
 * navigation entry.
 */
export function JevUsagePanel(props: PanelComponentProps) {
  const view = usePanelView(props)
  const text = (key: PanelKey): string => view.text[key] ?? key

  const startAutoRefresh = props.startAutoRefresh
  useEffect(() => startAutoRefresh(), [startAutoRefresh])

  return (
    <div className="jev-main" role="region" aria-label={text('nav')}>
      <div className="jev-mainInner">
        <header className="jev-header">
          <div>
            <h2 className="jev-title">{text('nav')}</h2>
            <p className="jev-subtitle">{text('subtitle')}</p>
          </div>
          <span className="jev-spacer" />
          {view.updatedAt !== '' ? <span className="jev-meta">{text('updated')} {view.updatedAt}</span> : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={view.loading}
            onClick={() => props.refresh()}
          >
            {view.loading ? text('refreshing') : text('refresh')}
          </Button>
          {/* The dashboard REPLACES the conversation in the center column;
              without an exit the user cannot get back to the session. */}
          <Button
            variant="ghost"
            size="sm"
            className="jev-close"
            aria-label={text('close')}
            title={text('closeHint')}
            onClick={() => props.close()}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        {view.noKey ? (
          <div className="jev-notice">
            <p className="jev-noticeTitle">{text('noKey')}</p>
            <p className="jev-noticeHint">{text('noKeyHint')}</p>
          </div>
        ) : null}

        {view.failure !== undefined ? (
          <div className="jev-notice jev-noticeError" role="alert">
            <p className="jev-noticeTitle">{text(view.failure.title)}</p>
            {view.failure.detail !== '' ? <p className="jev-noticeDetail">{view.failure.detail}</p> : null}
          </div>
        ) : null}

        {!view.noKey && view.failure === undefined && view.loading && view.local.length === 0 ? (
          <p className="jev-hint">{text('loading')}</p>
        ) : null}

        {view.localOnly && !view.noKey ? (
          <div className="jev-notice">
            <p className="jev-noticeTitle">{text('noUsageEndpoint')}</p>
            <p className="jev-noticeHint">{text('noUsageEndpointHint')}</p>
          </div>
        ) : null}

        {view.hasAccount ? (
          <section className="jev-card" aria-label={text('account')}>
            <header className="jev-cardHead">
              <span className="jev-avatar" aria-hidden="true">
                {(view.accountName.trim() === '' ? 'J' : view.accountName.trim()[0]!).toUpperCase()}
              </span>
              <span className="jev-cardTitle">
                {view.accountName !== '' ? view.accountName : text('account')}
              </span>
              <span className="jev-spacer" />
              {view.plan !== '' ? <span className="jev-badge">{view.plan}</span> : null}
            </header>

            {view.creditBar !== undefined ? <QuotaBar bar={view.creditBar} text={text} /> : null}
            {view.tokenBar !== undefined ? <QuotaBar bar={view.tokenBar} text={text} /> : null}

            {view.balance !== '' ? (
              <div className="jev-planRow">
                <span className="jev-fieldLabel">{text('balance')}</span>
                <span>{view.balance}</span>
              </div>
            ) : null}
            {view.remaining !== '' ? (
              <div className="jev-planRow">
                <span className="jev-fieldLabel">{text('remaining')}</span>
                <span>{view.remaining}</span>
              </div>
            ) : null}
            {view.resetsAt !== '' ? (
              <p className="jev-windowReset">{text('resets')} {view.resetsAt}</p>
            ) : null}
            {view.accountError !== '' ? (
              <p className="jev-hint" role="status">{text('errorGeneric')} — {view.accountError}</p>
            ) : null}
          </section>
        ) : null}

        {view.local.length > 0 ? (
          <section className="jev-card" aria-label={text('localTitle')}>
            <h4 className="jev-blockTitle">{text('localTitle')}</h4>
            <div className="jev-tiles">
              {view.local.map((stat: PanelStatView) => (
                <Tile key={stat.label} label={text(stat.label)} value={stat.value} />
              ))}
            </div>
            <p className="jev-hint">{text('localHint')}</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The sidebar footer card, registered into `sidebar.footer.action` — the
 * list the shell renders in the sidebar's foot area directly ABOVE the
 * Settings seat.
 *
 * The shell wraps nothing here, so this component owns the surface: the
 * button, its chrome and its accessible name. In the expanded column it
 * draws the headline quota bar (account credits when reported, otherwise the
 * local token total); in the 56px rail it collapses to a 36px icon button
 * carrying the ring. `wide` comes from the shell as an owner prop.
 */
export function JevFooterEntry(props: JevFooterEntryProps) {
  const view = usePanelView(props)
  const text = (key: PanelKey): string => view.text[key] ?? key

  const startAutoRefresh = props.startAutoRefresh
  useEffect(() => startAutoRefresh(), [startAutoRefresh])

  const headline = view.headline
  const ringPercent = headline?.barPercent ?? 0
  const warn = headline?.exhausted ?? false

  // The tooltip doubles as the accessible name; it always begins with the
  // visible title, so the label the user reads is contained in the name.
  const title = headline !== undefined && headline.value !== ''
    ? `${text('footerTitle')} — ${headline.value}`
    : text('footerTitle')

  if (!props.wide) {
    return (
      <button
        type="button"
        className="jev-rail"
        aria-label={title}
        title={title}
        onClick={() => props.open()}
      >
        <Ring percent={ringPercent} warn={warn} size={20} />
      </button>
    )
  }

  return (
    <button
      type="button"
      className="jev-foot"
      aria-label={title}
      title={title}
      onClick={() => props.open()}
    >
      <span className="jev-footHead">
        <Ring percent={ringPercent} warn={warn} size={16} />
        <span>{text('footerTitle')}</span>
        {headline !== undefined && headline.percent !== '' ? (
          <span className="jev-footPct">{headline.percent}</span>
        ) : null}
      </span>
      {headline !== undefined ? (
        <span className="jev-bar" aria-hidden="true">
          <span
            className={headline.exhausted ? 'jev-barFill jev-barFillWarn' : 'jev-barFill'}
            style={{ width: `${Math.min(100, Math.max(0, headline.barPercent))}%`, display: 'block', height: '100%' }}
          />
        </span>
      ) : null}
      {headline !== undefined && headline.value !== '' ? (
        <span className="jev-footValue">{headline.value}</span>
      ) : null}
      {view.noKey ? <span className="jev-footHint">{text('noKey')}</span> : null}
      {view.failure !== undefined ? (
        <span className="jev-footHint">{text('errorTitle')}</span>
      ) : null}
    </button>
  )
}
