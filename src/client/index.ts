/**
 * Browser entry for the Jev Auto Review plugin.
 *
 * Mounts two surfaces onto the DeepSeek Harness web client:
 *
 * 1. A "Jev Auto Review" settings page (a `settings.section` entry at the
 *    same nav level as General / Models / Plugins) that owns the API key
 *    (written through the credentials domain under `TYPESAFE_API_KEY`) and
 *    the endpoint / usageEndpoint / model fields.
 * 2. A quota card pinned in the sidebar's foot area (a
 *    `sidebar.footer.action` entry) that opens a usage dashboard in the
 *    center column (the layout's keyed `main` slot). The card renders the
 *    `jev/report` Remote's account snapshot plus this host's local counters.
 *
 * Mounting order is load-bearing and mirrors the reference provider:
 * everything waits for the `remote.credentials` NAMESPACE (a concrete,
 * already-mounted Typert namespace service) rather than the bare `remote`
 * gateway shell — a mount attempted off the bare shell runs on a context the
 * Gateway cannot create effects on ("cannot create effect on inactive
 * context"). The `jev/report` contribution is then mounted from that live
 * context, and the namespace it creates (`remote.jev`) is resolved through a
 * dynamic inject, because a static one would deadlock the mounter on its own
 * mount.
 *
 * The bundle is deliberately self-contained: every import outside the
 * platform's seeded modules (`@deepseek-ai/cordis`, `react`, the client-ui
 * primitives) is a relative module that gets inlined, so no cross-plugin
 * module request ever happens at runtime.
 *
 * @module @dsh-external/dsh-auto-review-jev/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only imports that pull in the client-service Context augmentations
// (`slots`/`remote`/`locale`/`settingsScope`) without adding a runtime module
// request the loader may not seed.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { JevUsageController } from './usage.ts'
import type { UsageRemote } from './usage.ts'
import { JevSettingsController } from './settings.ts'
import type { SettingsPageApi } from './settings.ts'
import { JEV_SETTINGS_NS } from '../wire-shared.ts'
import { createSnapshotStore } from './snapshot-store.ts'
import { JevFooterEntry, JevUsagePanel } from './panel-view.tsx'
import type { PanelInjected } from './panel-view.tsx'
import { JevSettingsPage } from './section.tsx'
import { injectPageCss } from './page-styles.ts'
import { injectPanelCss } from './panel-styles.ts'
import { PANEL_COPY_EN, PANEL_COPY_ZH, PANEL_LOCALE_NS } from './panel-copy.ts'
import { SETTINGS_COPY_EN, SETTINGS_COPY_ZH, SETTINGS_LOCALE_NS } from './settings-copy.ts'
import { USAGE_REMOTE_CONTRIBUTION } from '../usage-wire.ts'
import './panel-slots.ts'

/**
 * The `main` slot key AND the footer card's entry id. The layout resolves
 * `selectPanel(id)` against the keyed `main` registry; both registrations
 * carry it so card and dashboard stay one navigation entry.
 */
const PANEL_ID = 'jev-auto-review-usage'

/**
 * The reserved `main` key ui-conversation occupies (a layout whose
 * `selectPanel` predates the `null` form accepts only a registered key).
 */
const CONVERSATION_PANEL_ID = 'conversation'

/**
 * The one shot of the `layout` service this plugin needs, declared
 * structurally: importing the package would make the browser resolve a
 * client module this bundle never calls. Reached through the reflective
 * `ctx.get('layout')`, never a bare `ctx.layout` property — cordis throws
 * for an undeclared service, and declaring `layout` statically would park
 * the whole client fiber on a service some profiles never mount.
 */
interface LayoutSelectionSeam {
  /** `null` shows the Conversation again; a string selects that registered `main` key. */
  selectPanel(id: string | null): void
}

/** Client plugin body. Gates on the services the web profile always seeds. */
export function apply(ctx: Context): void {
  ctx.effect(() => injectPageCss(), '@dsh-external/dsh-auto-review-jev: page styles')
  ctx.effect(() => injectPanelCss(), '@dsh-external/dsh-auto-review-jev: panel styles')
  ctx.effect(
    () => ctx.locale.register(SETTINGS_LOCALE_NS, { zh: SETTINGS_COPY_ZH, en: SETTINGS_COPY_EN }),
    '@dsh-external/dsh-auto-review-jev: settings copy',
  )
  ctx.effect(
    () => ctx.locale.register(PANEL_LOCALE_NS, { zh: PANEL_COPY_ZH, en: PANEL_COPY_EN }),
    '@dsh-external/dsh-auto-review-jev: panel copy',
  )

  // `remote.credentials` is a concrete mounted namespace, so this callback
  // runs on a context the Typert Gateway can create effects on. See the
  // module doc for why the bare `remote` shell is not enough.
  ctx.inject(['remote.credentials'], (remoteCtx) => {
    applyClientSurfaces(remoteCtx)
  })
}

/** Mount every surface over the live Remote context. */
function applyClientSurfaces(ctx: Context): void {
  const credentials = (ctx.remote as unknown as { credentials: SettingsPageApi['credentials'] }).credentials

  // The `jev/report` namespace, resolved once the mount below lands. Unset
  // until then, so the controller degrades to the "not mounted" branch.
  let usageNamespace: UsageRemote | undefined
  let mountError: string | undefined

  // Constructed BEFORE the mount effect: the mount's `.then` callback (and the
  // namespace inject inside it) refreshes through this controller, so it must
  // already be initialized by the time that callback runs.
  const usageRemote: UsageRemote = {
    report: async () => {
      const namespace = usageNamespace
      if (namespace === undefined) {
        return { ok: false, error: { message: mountError ?? 'jev/report remote is not mounted' } }
      }
      return namespace.report()
    },
  }
  const usageController = new JevUsageController(usageRemote)
  const usageStore = createSnapshotStore(usageController.state())
  usageController.subscribe(() => usageStore.set(usageController.state()))
  ctx.effect(() => () => usageController.dispose(), '@dsh-external/dsh-auto-review-jev: usage controller')

  // Mount this plugin's Remote contribution. A Host half that predates the
  // Remote answers the calls with a failure the surfaces render.
  ctx.effect(() => {
    let cancelled = false
    let unmount: (() => Promise<void>) | undefined
    void (ctx.remote as unknown as {
      $mount(c: typeof USAGE_REMOTE_CONTRIBUTION): Promise<() => Promise<void>>
    }).$mount(USAGE_REMOTE_CONTRIBUTION).then((dispose: () => Promise<void>) => {
      if (cancelled) {
        void dispose()
        return
      }
      unmount = dispose
      // The namespace service exists only after the mount, so it is resolved
      // through a dynamic inject; a static one would deadlock the mounter.
      ctx.inject(['remote.jev'], (namespaceCtx) => {
        usageNamespace = (namespaceCtx.remote as unknown as { jev: UsageRemote }).jev
        // First paint: fill the card as soon as the namespace is live.
        void usageController.refresh()
        namespaceCtx.effect(() => () => {
          usageNamespace = undefined
        }, '@dsh-external/dsh-auto-review-jev: jev namespace')
      })
    }, (error: unknown) => {
      mountError = error instanceof Error ? error.message : String(error)
      console.error('[@dsh-external/dsh-auto-review-jev] could not mount the jev/report remote:', error)
    })
    return () => {
      cancelled = true
      usageNamespace = undefined
      if (unmount !== undefined) void unmount()
    }
  }, '@dsh-external/dsh-auto-review-jev: usage remote')

  const settingsScope = ctx.settingsScope.bind<Record<string, unknown>>({ namespace: JEV_SETTINGS_NS })
  const settingsController = new JevSettingsController(settingsScope, { credentials })
  const settingsStore = createSnapshotStore(settingsController.state())
  settingsController.subscribe(() => settingsStore.set(settingsController.state()))
  ctx.effect(() => () => settingsController.dispose(), '@dsh-external/dsh-auto-review-jev: settings controller')

  const openPanel = (): void => {
    const layout = ctx.get('layout') as LayoutSelectionSeam | undefined
    if (typeof layout?.selectPanel === 'function') layout.selectPanel(PANEL_ID)
  }

  // The injected face both panel slots carry. `usageController` is already
  // constructed, so a click before the mount lands is a no-op, not a crash.
  const panelFace = (): PanelInjected => ({
    hooks: { jevUsage: usageStore },
    refresh: () => void usageController.refresh(),
    startAutoRefresh: () => makeAutoRefresh(usageController)(),
    open: openPanel,
    close: () => {
      const layout = ctx.get('layout') as LayoutSelectionSeam | undefined
      if (typeof layout?.selectPanel !== 'function') return
      try {
        layout.selectPanel(null)
      } catch {
        try {
          layout.selectPanel(CONVERSATION_PANEL_ID)
        } catch (error: unknown) {
          console.error('[@dsh-external/dsh-auto-review-jev] could not close the usage panel:', error)
        }
      }
    },
  })

  // The settings page: register the section once the `settings.section`
  // declaration is on the ledger (ui-settings-general owns the shell;
  // `slots.inject` waits for the declaration). The slot declares no
  // slot-level `inject` face, so the entry carries its own inject FACTORY —
  // the renderer binds the hooks compartment into `useX` props.
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'jev-auto-review',
      order: 12,
      label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)('nav'),
      locale: SETTINGS_LOCALE_NS,
      inject: () => ({
        hooks: { jevSettings: settingsStore },
        edit: (field: string, text: string) => settingsController.edit(field as 'apiKey' | 'endpoint' | 'usageEndpoint' | 'model', text),
        resetField: (field: string) => settingsController.resetField(field as 'apiKey' | 'endpoint' | 'usageEndpoint' | 'model'),
        stageKeyClear: () => settingsController.stageKeyClear(),
        save: () => void settingsController.save().then(() => {
          if (!settingsController.state().failed) void usageController.refresh()
        }),
        discard: () => settingsController.discard(),
        openUsage: openPanel,
      }),
    }, JevSettingsPage))
  } catch (error: unknown) {
    console.error('[@dsh-external/dsh-auto-review-jev] could not register the settings section:', error)
  }

  // The quota dashboard cell in the center column. Registering a cell for a
  // declaration that never arrives is a no-op by construction.
  try {
    ctx.slots.inject('main', () => ctx.slots.register(
      { name: 'main', key: PANEL_ID, locale: PANEL_LOCALE_NS, inject: panelFace },
      JevUsagePanel,
    ))
  } catch (error: unknown) {
    console.error('[@dsh-external/dsh-auto-review-jev] could not register the usage panel:', error)
  }

  // The sidebar footer card. Gated on the `layout` service so a profile
  // without ui-layout (TUI, headless) never registers a card whose click
  // would silently do nothing — `open()` needs `layout.selectPanel`.
  ctx.inject(['layout'], (layoutCtx) => {
    const layout = layoutCtx.get('layout') as LayoutSelectionSeam | undefined
    if (typeof layout?.selectPanel !== 'function') return
    try {
      layoutCtx.slots.inject('sidebar.footer.action', () => layoutCtx.slots.register(
        { name: 'sidebar.footer.action', id: PANEL_ID, order: 1, locale: PANEL_LOCALE_NS, inject: panelFace },
        JevFooterEntry,
      ))
    } catch (error: unknown) {
      console.error('[@dsh-external/dsh-auto-review-jev] could not register the sidebar footer card:', error)
    }
  })
}

/**
 * Start the shared background poll behind the quota card. The browser poll
 * only re-reads the Host's cached report through the Remote (cheap); the Host
 * side owns the real account-endpoint fetch cadence. Returns the disposer;
 * concurrent mounts share one interval.
 */
function makeAutoRefresh(controller: JevUsageController): () => () => void {
  let mounts = 0
  let timer: ReturnType<typeof setInterval> | undefined
  return () => {
    mounts += 1
    void controller.refresh()
    if (timer === undefined) {
      timer = setInterval(() => void controller.refresh(), 60_000)
    }
    return () => {
      mounts -= 1
      if (mounts <= 0 && timer !== undefined) {
        clearInterval(timer)
        timer = undefined
        mounts = 0
      }
    }
  }
}

export const inject: readonly string[] = [
  'slots',
  'locale',
  'remote',
  'settingsScope',
]
