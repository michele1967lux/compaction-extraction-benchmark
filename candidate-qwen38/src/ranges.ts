/**
 * Surface retention selection: resolve the next head-anchored range while
 * retaining a priced recent tail and never splitting an assistant
 * tool-call/result pair.
 *
 * Ported from `dsh-compaction-basic/src/region.ts` (`selectCompactableRange`).
 *
 * @module ./ranges
 */

import type { ISession, TokenMeasurement } from './session.ts'
import { toolPairingBalancedBefore } from './tool-pairing.ts'

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
    const node = pricedNodes[index]
    if (node === undefined) continue
    accumulated += node.tokens
    keepFromIdx = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIdx === 0) return null

  while (keepFromIdx > 0) {
    const seq = surfaceNodes[keepFromIdx]
    if (seq === undefined) break
    if (toolPairingBalancedBefore(session, seq)) break
    keepFromIdx -= 1
  }
  if (keepFromIdx === 0) return null

  const first = surfaceNodes[0]
  const cutoff = surfaceNodes[keepFromIdx - 1]
  if (first === undefined || cutoff === undefined) return null
  return { start: first, end: cutoff }
}
