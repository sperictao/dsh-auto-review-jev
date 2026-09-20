/**
 * The settings-page stylesheet, injected once by the client entry. Classes
 * are `jevs-` prefixed to stay clear of the quota panel's `jev-` set.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/page-styles
 */

const CSS = `
.jevs-page { max-width: 640px; margin: 0 auto; padding: 24px 20px 96px; }
.jevs-title { margin: 0; font-size: 18px; font-weight: 650; }
.jevs-subtitle { margin: 4px 0 20px; font-size: 12px; opacity: 0.65; }
.jevs-field { margin-bottom: 16px; }
.jevs-fieldHead { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.jevs-label { font-size: 13px; font-weight: 600; }
.jevs-badges { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.jevs-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-tertiary, rgba(128, 128, 128, 0.18));
  font-size: 11px;
}
.jevs-badgeOk { color: var(--dsw-alias-state-success-primary, #30a46c); }
.jevs-badgeWarn { color: var(--dsw-alias-state-error-primary, #e5484d); }
.jevs-reset {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  opacity: 0.6;
  cursor: pointer;
}
.jevs-reset:hover { opacity: 1; }
.jevs-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  background: var(--dsw-alias-bg-primary, transparent);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.jevs-input:focus { outline: 2px solid var(--dsw-alias-border-focus, rgba(80, 140, 255, 0.6)); outline-offset: 1px; }
.jevs-inputInvalid { border-color: var(--dsw-alias-state-error-primary, #e5484d); }
.jevs-hint { margin: 6px 0 0; font-size: 11px; opacity: 0.6; }
.jevs-invalid { margin: 6px 0 0; font-size: 11px; color: var(--dsw-alias-state-error-primary, #e5484d); }
.jevs-keyRow { display: flex; gap: 8px; align-items: center; }
.jevs-keyRow .jevs-input { flex: 1; }
.jevs-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 12px 0;
  background: var(--dsw-alias-bg-primary, inherit);
}
.jevs-error { color: var(--dsw-alias-state-error-primary, #e5484d); font-size: 12px; margin: 0 0 10px; }
.jevs-clear {
  border: 1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.3));
  background: none;
  border-radius: 8px;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.jevs-clear:hover { border-color: var(--dsw-alias-state-error-primary, #e5484d); }
`

/** Inject the settings-page stylesheet once; returns the teardown. */
export function injectPageCss(): () => void {
  const tag = document.createElement('style')
  tag.dataset.jevSettings = ''
  tag.textContent = CSS
  document.head.append(tag)
  return () => tag.remove()
}
