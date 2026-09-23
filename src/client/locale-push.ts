/**
 * Tell the Host which language the browser is rendering in.
 *
 * The reprieve dialog a denial raises is assembled on the Host, and the Host
 * cannot work out the language on its own: DSH's locale preference lives in the
 * Host settings document, but an UNSET preference deliberately delegates to the
 * browser, so the common case (a browser-language-derived UI, never touched in
 * Settings) is invisible Host-side. The browser does know, because the locale
 * runtime resolves the preference over the browser's own language, so it pushes
 * that resolved id over the `jev/locale` Remote and the Host answers in kind.
 *
 * The push is fire-and-forget on purpose: a dialog whose language is unknown
 * still has to appear, and the Host falls back to English when nothing arrived.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/locale-push
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The narrow slice of the mounted Remote this push calls. */
export interface LocalePushRemote {
  setLocale(active: string): Promise<RemoteResult<boolean>>
}

/**
 * Push the active locale now, and again whenever it changes.
 *
 * @param ctx - the context that owns the namespace (its disposal ends the push).
 * @param namespace - the mounted `jev` namespace.
 */
export function pushUiLocale(ctx: Context, namespace: LocalePushRemote): void {
  const send = (active: string): void => {
    // A failed push is not worth surfacing: the Host keeps the language it had.
    void Promise.resolve(namespace.setLocale(active)).catch(() => undefined)
  }
  send(ctx.locale.getLocale().active)
  ctx.effect(
    () => ctx.on('locale/change', (snapshot) => send(snapshot.active)),
    '@dsh-external/dsh-auto-review-jev: locale push',
  )
}
