/**
 * A tiny observable snapshot store — the `getSnapshot` / `subscribe` / `set`
 * triple React's `useSyncExternalStore` consumes through the harness slot kit
 * (the host builds each slot's `useFoo(selector)` hook from one of these).
 *
 * Vendored on purpose (same reasoning as the reference provider): inlining
 * the small subset used here avoids a version-specific module request while
 * preserving the slot-hook contract.
 *
 * @module @dsh-external/dsh-auto-review-jev/client/snapshot-store
 */

/** Mutable observable snapshot consumed by slot hooks. */
export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(value: T): void
}

/** Notify every subscriber without letting one faulty UI consumer suppress the rest. */
function notifyListeners(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error: unknown) {
      console.error('[@dsh-external/dsh-auto-review-jev] snapshot subscriber failed:', error)
    }
  }
}

/** Create one observable snapshot store. */
export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(value: T) {
      if (Object.is(value, snapshot)) return
      snapshot = value
      notifyListeners(listeners)
    },
  }
}
