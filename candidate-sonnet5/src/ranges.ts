/**
 * Read-only surface-range selection and validation for compaction: which
 * inclusive positional span of the current surface is safe to compact, and
 * whether a caller-supplied span is a valid replacement target.
 *
 * Verbatim port of two functions from
 * `packages/compaction/compaction-basic/src/region.ts`
 * (`@deepseek-ai/dsh-compaction-basic`):
 * - `selectCompactableRange` — unchanged name and algorithm.
 * - `validateSurfaceRegion` — same algorithm, renamed `validateRangeSelection`
 *   per TASK.md's deliverable file list (`ranges.ts # selectCompactableRange,
 *   validateRangeSelection`). In the source this function is private to
 *   `region.ts` and reused internally by `assertSelectedSpanStable`; here it
 *   is promoted to a named export of this module so both `ranges.ts`'s own
 *   selection logic and `transaction.ts`'s stability re-check can share one
 *   definition without duplicating it.
 *
 * @module ranges
 */

import { toolPairingBalancedAfter, toolPairingBalancedBefore } from './tool-pairing.js'
import type { ISession, TokenMeasurement } from './session.js'

/** One validated inclusive span of current surface positions. */
export interface SurfaceSelection {
  readonly start: number
  readonly end: number
  readonly startIdx: number
  readonly endIdx: number
  readonly shadowedSeqs: readonly number[]
}

/**
 * Resolve the next head-anchored range while retaining a priced recent tail
 * and never splitting an assistant tool-call/result pair.
 * @param session - session supplying authoritative current surface positions.
 * @param measurement - unified pressure and surface measurement from the conversation meter.
 * @param retainTokens - minimum recent tail budget retained verbatim.
 * @returns the inclusive positional seq range to compact, or `null`.
 */
export function selectCompactableRange(
  session: ISession,
  measurement: TokenMeasurement,
  retainTokens: number,
): { start: number; end: number } | null {
  const pricedNodes = measurement.nodes
  if (pricedNodes.length === 0) return null

  const surfaceNodes = session.surface.nodes
  if (surfaceNodes.length !== pricedNodes.length
    || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
    throw new Error('compaction: token-meter surface does not match the current session surface')
  }

  let accumulated = 0
  let keepFromIdx = pricedNodes.length
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    accumulated += pricedNodes[index]!.tokens
    keepFromIdx = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIdx === 0) return null

  while (keepFromIdx > 0) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx]!)) break
    keepFromIdx -= 1
  }
  if (keepFromIdx === 0) return null

  // oxlint-disable-next-line typescript/no-non-null-assertion
  const first = surfaceNodes[0]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const cutoff = surfaceNodes[keepFromIdx - 1]!
  return { start: first, end: cutoff }
}

/**
 * Validate one requested surface-position span before asynchronous work
 * begins: both edges must exist on the current surface, in order, and both
 * must be tool-pairing balanced boundaries.
 * @param session - session whose current surface is checked.
 * @param start - first surface-node seq, inclusive.
 * @param end - last surface-node seq, inclusive.
 * @returns the validated selection with its surface positions and shadowed seqs.
 * @throws when either seq is absent from the surface, `start` is after `end`,
 * or either boundary would split a tool-call/result pair.
 */
export function validateRangeSelection(session: ISession, start: number, end: number): SurfaceSelection {
  const nodes = session.surface.nodes
  const startIdx = nodes.indexOf(start)
  const endIdx = nodes.indexOf(end)
  if (startIdx === -1) throw new Error(`compactRegion: start seq ${start} not found in surface`)
  if (endIdx === -1) throw new Error(`compactRegion: end seq ${end} not found in surface`)
  if (startIdx > endIdx) {
    throw new Error(
      `compactRegion: start seq ${start} (position ${startIdx}) is after end seq ${end} (position ${endIdx}) on the surface`,
    )
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedBefore(session, nodes[startIdx]!)) {
    throw new Error(`compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`)
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedAfter(session, nodes[endIdx]!)) {
    throw new Error(`compactRegion: end seq ${end} is not a balanced boundary (would split a step, or the step is still open)`)
  }

  return { start, end, startIdx, endIdx, shadowedSeqs: nodes.slice(startIdx, endIdx + 1) }
}
