/**
 * The panel stylesheet, injected once by the client entry. Classes are
 * `jev-` prefixed to stay clear of every other surface.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/panel-styles
 */

const CSS = `
.jev-foot {
  display: block;
  width: 100%;
  padding: 10px 12px;
  margin: 4px 0;
  border: 1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.24));
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.jev-foot:hover { background: var(--dsw-alias-bg-secondary, rgba(128, 128, 128, 0.08)); }
.jev-footHead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}
.jev-footPct { margin-left: auto; font-variant-numeric: tabular-nums; opacity: 0.8; }
.jev-bar {
  height: 4px;
  margin-top: 8px;
  border-radius: 2px;
  background: var(--dsw-alias-bg-tertiary, rgba(128, 128, 128, 0.18));
  overflow: hidden;
}
.jev-barFill {
  height: 100%;
  border-radius: 2px;
  background: currentColor;
  transition: width 0.3s ease;
}
.jev-barFillWarn { background: var(--dsw-alias-state-error-primary, #e5484d); }
.jev-footValue { margin-top: 6px; font-size: 11px; opacity: 0.72; font-variant-numeric: tabular-nums; }
.jev-footHint { margin-top: 6px; font-size: 11px; opacity: 0.6; }
.jev-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 4px auto;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.jev-rail:hover { background: var(--dsw-alias-bg-secondary, rgba(128, 128, 128, 0.08)); }
.jev-glyph { display: inline-flex; flex: none; }

.jev-main { height: 100%; overflow-y: auto; }
.jev-mainInner { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; }
.jev-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
.jev-title { margin: 0; font-size: 18px; font-weight: 650; }
.jev-subtitle { margin: 4px 0 0; font-size: 12px; opacity: 0.65; }
.jev-spacer { flex: 1; }
.jev-meta { font-size: 11px; opacity: 0.6; align-self: center; }
.jev-close { font-size: 16px; line-height: 1; }
.jev-notice {
  padding: 12px 14px;
  margin-bottom: 16px;
  border: 1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.24));
  border-radius: 10px;
}
.jev-noticeError { border-color: var(--dsw-alias-state-error-primary, #e5484d); }
.jev-noticeTitle { margin: 0; font-size: 13px; font-weight: 600; }
.jev-noticeHint { margin: 4px 0 0; font-size: 12px; opacity: 0.7; }
.jev-noticeDetail { margin: 6px 0 0; font-size: 11px; opacity: 0.55; word-break: break-all; }
.jev-card {
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.24));
  border-radius: 12px;
}
.jev-cardHead { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.jev-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-tertiary, rgba(128, 128, 128, 0.18));
  font-size: 13px;
  font-weight: 650;
}
.jev-cardTitle { font-size: 14px; font-weight: 600; }
.jev-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-tertiary, rgba(128, 128, 128, 0.18));
  font-size: 11px;
}
.jev-window { margin-bottom: 12px; }
.jev-windowHead { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.jev-windowLabel { font-weight: 600; }
.jev-windowValue { margin-left: auto; opacity: 0.75; font-variant-numeric: tabular-nums; }
.jev-windowPct { opacity: 0.75; font-variant-numeric: tabular-nums; }
.jev-windowReset { margin: 4px 0 0; font-size: 11px; opacity: 0.55; }
.jev-planRow { display: flex; gap: 8px; font-size: 12px; margin-bottom: 8px; }
.jev-fieldLabel { opacity: 0.6; }
.jev-blockTitle { margin: 14px 0 8px; font-size: 12px; font-weight: 600; opacity: 0.7; }
.jev-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.jev-tile {
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-primary, rgba(128, 128, 128, 0.18));
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.jev-tileLabel { font-size: 11px; opacity: 0.6; }
.jev-tileValue { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.jev-hint { font-size: 12px; opacity: 0.6; }
`

/** Inject the panel stylesheet once; returns the teardown. */
export function injectPanelCss(): () => void {
  const tag = document.createElement('style')
  tag.dataset.jevPanel = ''
  tag.textContent = CSS
  document.head.append(tag)
  return () => tag.remove()
}
