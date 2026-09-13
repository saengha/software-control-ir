import type { State, StateSize } from "./types.js";

/** Rough token proxy. Good enough to compare two representations of one state. */
export function measureState(state: State): StateSize {
  const chars = JSON.stringify(state).length;
  return {
    objects: state.objects.length,
    chars,
    approxTokens: Math.ceil(chars / 4),
  };
}

export interface StateSizeComparison {
  full: StateSize;
  relevant: StateSize;
  savedTokens: number;
  relevantShare: number;
}

export function compareStateSize(full: State, relevant: State): StateSizeComparison {
  const fullSize = measureState(full);
  const relevantSize = measureState(relevant);
  return {
    full: fullSize,
    relevant: relevantSize,
    savedTokens: fullSize.approxTokens - relevantSize.approxTokens,
    relevantShare: Number((relevantSize.approxTokens / fullSize.approxTokens).toFixed(3)),
  };
}
