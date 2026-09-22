/**
 * React component for the "Auto Review Jev" settings page (browser half).
 *
 * Renders as a `settings.section` entry — a page at the same settings-nav
 * level as General / Models / Plugins. All copy comes from the
 * `settings.jev-auto-review` locale namespace; all state comes from the
 * `JevSettingsController` and the usage controller injected by the slot
 * registration.
 *
 * The page leads with the usage panel (see {@link JevUsagePanel}) and then the
 * API key, the endpoints and the model: what the reviewer consumed, then what
 * it authenticates with.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/section
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsKey } from './settings-copy.ts'
import type { SettingsPageState, StagedField } from './settings.ts'
import type { UsagePageState } from './usage.ts'
import type { PanelKey } from './panel-copy.ts'
import { JevUsagePanel } from './panel-view.tsx'

/** Props composed by the slot registration: locale seat + injected face. */
export interface JevSettingsProps {
  t: Translate<SettingsKey>
  useJevSettings<T>(selector: (state: SettingsPageState) => T): T
  /** Usage snapshot seat, bound from the face's `hooks.jevUsage` member. */
  useJevUsage<T>(selector: (state: UsagePageState) => T): T
  /** Panel copy, bound by the entry to the `panel.jev` locale namespace. */
  panelText?: Translate<PanelKey> | undefined
  edit(field: string, text: string): void
  resetField(field: string): void
  stageKeyClear(): void
  save(): void
  discard(): void
  /** Fetch the usage report now (the panel's Refresh action). */
  refresh(): void
  /** Start the panel's background poll; returns its disposer. */
  startAutoRefresh(): () => void
}

/** One labelled text field row. */
function Field({
  id,
  label,
  hint,
  state,
  disabled,
  placeholder,
  invalidText,
  onEdit,
  onReset,
  t,
}: {
  id: string
  label: string
  hint: string
  state: StagedField
  disabled: boolean
  placeholder?: string | undefined
  invalidText: string
  onEdit(text: string): void
  onReset(): void
  t: Translate<SettingsKey>
}) {
  return (
    <div className="jevs-field">
      <div className="jevs-fieldHead">
        <label className="jevs-label" htmlFor={id}>{label}</label>
        <span className="jevs-badges">
          {state.overridden ? <span className="jevs-badge">{t('overridden')}</span> : null}
          <button type="button" className="jevs-reset" disabled={disabled} onClick={onReset} aria-label={`${label} — ${t('reset')}`}>{t('reset')}</button>
        </span>
      </div>
      <input
        id={id}
        className={state.invalid ? 'jevs-input jevs-inputInvalid' : 'jevs-input'}
        type="text"
        value={state.text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onEdit(event.target.value)}
      />
      <p className={state.invalid ? 'jevs-invalid' : 'jevs-hint'}>
        {state.invalid ? invalidText : hint}
      </p>
    </div>
  )
}

/** The settings page body. */
export function JevSettingsPage(props: JevSettingsProps) {
  const state = props.useJevSettings((snapshot) => snapshot)
  const t = props.t
  const disabled = !state.available || !state.writable || state.saving

  return (
    <div className="jevs-page">
      <h2 className="jevs-title">{t('title')}</h2>
      <p className="jevs-subtitle">{t('subtitle')}</p>

      {/* Usage first: what the reviewer consumed, then what it authenticates
          with. The panel owns its heading, refresh action and background
          poll, so the page only has to place it. */}
      <JevUsagePanel
        useJevUsage={props.useJevUsage}
        panelText={props.panelText}
        refresh={props.refresh}
        startAutoRefresh={props.startAutoRefresh}
      />

      <div className="jevs-field">
        <div className="jevs-fieldHead">
          <label className="jevs-label" htmlFor="jev-apiKey">{t('apiKey')}</label>
          <span className="jevs-badges">
            {state.apiKeyConfigured
              ? <span className="jevs-badge jevs-badgeOk">{t('apiKeyConfigured')}</span>
              : <span className="jevs-badge jevs-badgeWarn">{t('apiKeyMissing')}</span>}
            {state.apiKeyClearStaged ? <span className="jevs-badge jevs-badgeWarn">{t('apiKeyClearStaged')}</span> : null}
            <button
              type="button"
              className="jevs-reset"
              disabled={disabled}
              onClick={() => props.resetField('apiKey')}
              aria-label={`${t('apiKey')} — ${t('reset')}`}
            >
              {t('reset')}
            </button>
          </span>
        </div>
        <div className="jevs-keyRow">
          <input
            id="jev-apiKey"
            className="jevs-input"
            type="password"
            autoComplete="off"
            value={state.apiKey.text}
            placeholder={state.apiKeyConfigured ? '••••••••' : ''}
            disabled={disabled || !state.apiKeyWritable}
            onChange={(event) => props.edit('apiKey', event.target.value)}
          />
          {state.apiKeyConfigured && !state.apiKeyClearStaged ? (
            <button
              type="button"
              className="jevs-clear"
              disabled={disabled || !state.apiKeyWritable}
              onClick={() => props.stageKeyClear()}
            >
              {t('apiKeyClear')}
            </button>
          ) : null}
        </div>
        <p className="jevs-hint">{t('apiKeyHint')}</p>
      </div>

      <Field
        id="jev-endpoint"
        label={t('endpoint')}
        hint={t('endpointHint')}
        state={state.endpoint}
        disabled={disabled}
        placeholder="https://api.typesafe.ai/v1/systemone"
        invalidText={t('invalidUrl')}
        onEdit={(text) => props.edit('endpoint', text)}
        onReset={() => props.resetField('endpoint')}
        t={t}
      />
      <Field
        id="jev-usageEndpoint"
        label={t('usageEndpoint')}
        hint={t('usageEndpointHint')}
        state={state.usageEndpoint}
        disabled={disabled}
        placeholder="https://api.typesafe.ai/v1/usage"
        invalidText={t('invalidUrl')}
        onEdit={(text) => props.edit('usageEndpoint', text)}
        onReset={() => props.resetField('usageEndpoint')}
        t={t}
      />
      <Field
        id="jev-model"
        label={t('model')}
        hint={t('modelHint')}
        state={state.model}
        disabled={disabled}
        placeholder="jev-latest"
        invalidText=""
        onEdit={(text) => props.edit('model', text)}
        onReset={() => props.resetField('model')}
        t={t}
      />

      {state.failed ? <p className="jevs-error" role="alert">{t('savedFailed')}</p> : null}

      <div className="jevs-footer">
        <Button variant="primary" size="sm" disabled={disabled || !state.dirty} onClick={() => props.save()}>
          {state.saving ? t('saving') : t('save')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!state.dirty || state.saving} onClick={() => props.discard()}>
          {t('discard')}
        </Button>
      </div>
    </div>
  )
}
