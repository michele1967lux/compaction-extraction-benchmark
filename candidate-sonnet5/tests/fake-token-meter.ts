/**
 * A minimal in-memory `ITokenMeter` for tests: prices every current surface
 * node with a caller-supplied per-seq cost (defaulting to a fixed 10 tokens),
 * and prices a hand-built message by its serialized JSON length. Not a port
 * of the real token meter's route/heuristic pricing split — just enough
 * determinism for range-selection and transaction tests to exercise
 * threshold/retention math without depending on real tokenizer behavior.
 */

import type { ISession, Message, TokenMeasurement } from '../src/session.js'

export class FakeTokenMeter {
  constructor(private readonly costBySeq = new Map<number, number>(), private readonly defaultCost = 10) {}

  setCost(seq: number, tokens: number): void {
    this.costBySeq.set(seq, tokens)
  }

  measure(session: ISession): TokenMeasurement {
    const nodes = session.surface.nodes.map(seq => {
      const tokens = this.costBySeq.get(seq) ?? this.defaultCost
      return { seq, tokens, heuristicTokens: tokens }
    })
    return {
      totalTokens: nodes.reduce((sum, node) => sum + node.tokens, 0),
      nodes,
    }
  }

  estimateMessage(message: Message): number {
    return Math.ceil(JSON.stringify(message.content).length / 4)
  }
}
