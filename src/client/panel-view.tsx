/**
 * React component for the Jev usage panel (browser half): the block the
 * settings page renders inline, directly above the API-key field.
 *
 * It renders one {@link PanelView} projected by `./panel.ts` — no fact is
 * derived here. Strings arrive already localized in `view.text`: the caller
 * hands over a `panelText` translate bound to the `panel.jev` namespace, so
 * the block follows the UI language, and a missing seat degrades to English
 * instead of crashing the surface.
 *
 * Styles ride the stylesheet `./panel-styles.ts` injects once; classes are
 * `jev-` prefixed.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/panel-view
 */

import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsagePageState } from './usage.ts'
import { buildPanelView } from './panel.ts'
import type { PanelBarView, PanelStatView, PanelView } from './panel.ts'
import { panelTextEN } from './panel-copy.ts'
import type { PanelKey } from './panel-copy.ts'

/**
 * The props the inline panel receives from the settings page. The renderer
 * destructures the registration's `hooks` compartment OUT of the inject face
 * and re-exposes each member as a `use<Name>` prop (`jevUsage` →
 * `useJevUsage`); the rest of the face lands verbatim.
 */
export interface JevUsagePanelProps {
  useJevUsage<T>(selector: (state: UsagePageState) => T): T
  /**
   * Translate bound to the `panel.jev` namespace. Optional so a profile
   * without the locale seat still renders the English copy.
   */
  panelText?: Translate<PanelKey> | undefined
  /** Fetch the report now (the block's Refresh action). */
  refresh(): void
  /** Start the shared background poll for this mount; returns its disposer. */
  startAutoRefresh(): () => void
}

/** The panel's view, recomputed on every notification. */
function usePanelView(props: JevUsagePanelProps): PanelView {
  const usage = props.useJevUsage((state) => state)
  const t = props.panelText ?? ((key: PanelKey) => panelTextEN[key] ?? key)
  const text = {} as Record<PanelKey, string>
  for (const key of Object.keys(panelTextEN) as PanelKey[]) text[key] = t(key)
  return buildPanelView({ usage, t: text })
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
 * The usage block: the account snapshot (avatar, plan, quota bars, balance,
 * reset), this host's counters, and the notices that explain a missing key, a
 * missing endpoint or a failed fetch.
 *
 * Rendered inline by the settings page above the API-key field, so it carries
 * no close action — it never takes over the center column — and its heading is
 * a section title under the page's own `<h2>`.
 */
export function JevUsagePanel(props: JevUsagePanelProps) {
  const view = usePanelView(props)
  const text = (key: PanelKey): string => view.text[key] ?? key

  const startAutoRefresh = props.startAutoRefresh
  useEffect(() => startAutoRefresh(), [startAutoRefresh])

  return (
    <section className="jev-panel" aria-label={text('nav')}>
      <header className="jev-panelHead">
        <h3 className="jev-panelTitle">{text('nav')}</h3>
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
      </header>
      <p className="jev-panelHint">{text('subtitle')}</p>

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
    </section>
  )
}
