/**
 * SlotMap merges for the panel slots this plugin registers into.
 *
 * Neither slot belongs to this plugin: `sidebar.footer.action` is declared by
 * the sidebar shell (ui-layout) and `main` by the layout service. Importing
 * this module for its side effect is what types the `ctx.slots.register`
 * calls in `./index.ts`.
 *
 * @module dsh-auto-review-jev/client/panel-slots
 */

// Marks this file as a module: without an import/export, TypeScript treats it
// as a script and the `declare module` below merges into nothing (taking the
// package's REAL exports down with it — TS2305 on `Translate` everywhere).
export {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The keyed center-column panel registry. `selectPanel(id)` resolves its
     * argument against this slot's entries.
     */
    main: { kind: 'keyed'; scope: 'root' }
    /**
     * The sidebar foot area, directly above the Settings seat. The shell
     * supplies only the column fold state; the entry owns its whole surface.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
  }
}
