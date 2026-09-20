/**
 * Shared boundary-validation and Remote-descriptor plumbing for the plugin's
 * hand-rolled Typert wire contract (`jev/report`).
 *
 * The single Remote this plugin serves crosses the Typert Gateway with a
 * strict result schema: the Host half registers a descriptor against a Cordis
 * service (`src/usage-remote.ts`) and the browser half mounts the matching
 * contribution on `ctx.remote` (`src/client/index.ts`). The wire contract is
 * deliberately dependency-free so the client bundle can inline it.
 *
 * @module @dsh-external/dsh-auto-review-jev/wire-shared
 */

import type { InvocationDescriptor, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'

/** The npm package identity every contribution and descriptor claims. */
export const REMOTE_PACKAGE = '@dsh-external/dsh-auto-review-jev'

/** The Cordis service key the Gateway resolves the Jev usage Remote from. */
export const REMOTE_SERVICE = 'jevUsage'

/** The wire namespace the endpoint lives under. */
export const REMOTE_NAMESPACE = 'jev'

/** The read/validate helpers one boundary codec needs. */
export interface BoundaryValidator {
  /** Reject one boundary value with a field-naming error. */
  reject(field: string): never
  /** Narrow an unknown value to a plain record, or reject. */
  record(value: unknown, field: string): Record<string, unknown>
  /** Read one required string field (`field` is the dotted error label). */
  stringField(source: Record<string, unknown>, key: string, field: string): string
  /** Read one required finite number field (`field` is the dotted error label). */
  numberField(source: Record<string, unknown>, key: string, field: string): number
  /** Read one required boolean field (`field` is the dotted error label). */
  booleanField(source: Record<string, unknown>, key: string, field: string): boolean
}

/**
 * Build the validator helpers one endpoint uses. `prefix` names the endpoint
 * in the rejection message (e.g. `jev/report result:`), so each wire file
 * keeps its own diagnostic phrasing while sharing the helper bodies.
 */
export function makeBoundaryValidator(prefix: string): BoundaryValidator {
  const reject = (field: string): never => {
    throw new TypeError(`${prefix} invalid ${field}`)
  }
  const record = (value: unknown, field: string): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : reject(field)
  const stringField = (source: Record<string, unknown>, key: string, field: string): string =>
    typeof source[key] === 'string' ? source[key] as string : reject(field)
  const numberField = (source: Record<string, unknown>, key: string, field: string): number =>
    typeof source[key] === 'number' && Number.isFinite(source[key] as number)
      ? source[key] as number
      : reject(field)
  const booleanField = (source: Record<string, unknown>, key: string, field: string): boolean =>
    typeof source[key] === 'boolean' ? source[key] as boolean : reject(field)
  return { reject, record, stringField, numberField, booleanField }
}

/**
 * One strict result codec written in BOTH Typert generations' vocabulary.
 *
 * The protocol changed shape under the same `mode: 'strict'` tag, and each
 * engine generation validates the member it knows while ignoring the other:
 *
 * - Every RELEASED engine (0.1.2-rc.1 … 0.1.6-alpha.1) declares
 *   `schema: TypertSchema`; its registry throws unless `codec.schema.parse`
 *   is a function, and its Gateway validates with `codec.schema.parse(value)`.
 * - master after commit `e459e3263` replaced that member with the lazy
 *   factory `create: () => TypertSchema` and validates with
 *   `codec.create().parse(value)`.
 *
 * So the one codec carries both, which is a version-agnostic fix rather than
 * a probe: neither validator inspects the member it does not know, and the
 * member the running engine does not read is inert.
 */
interface StrictResultCodec<Output> {
  readonly mode: 'strict'
  readonly typeSymbol: string
  /** Read by released engines (≤ `0.1.6-alpha.1`). */
  readonly schema: TypertSchema<Output>
  /** Read by engines after `e459e3263` — the lazy replacement for `schema`. */
  readonly create: () => TypertSchema<Output>
}

/**
 * Build one strict invocation descriptor. The Jev usage Remote has a single
 * endpoint, so the boilerplate lives here once and the wire file supplies
 * only its own facts.
 */
export function makeRemoteDescriptor<Output>(
  endpoint: string,
  method: string,
  typeSymbol: string,
  schema: TypertSchema<Output>,
): InvocationDescriptor {
  // Both members name the SAME hand-rolled schema: `create()` is the newer
  // generation's lazy accessor for what the older one reads directly, so the
  // two generations can never validate against different rules. Defined as a
  // value (not inline) so the older typings' excess-property check does not
  // reject the member they do not declare.
  const result: StrictResultCodec<Output> = {
    mode: 'strict',
    typeSymbol,
    schema,
    create: () => schema,
  }
  return {
    id: `${REMOTE_PACKAGE}#${endpoint}`,
    service: REMOTE_SERVICE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters: [],
    result,
  }
}
