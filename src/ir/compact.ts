import type { ActionResult, CompactResult, TransactionResult } from "./types.js";

/** Drop the before/after state copies an agent already has. */
export function compactResult(result: ActionResult): CompactResult {
  const compact: CompactResult = {
    status: result.status,
    revision: result.revision,
    effects: result.effects,
  };
  if (result.issues) compact.issues = result.issues;
  if (result.focus) compact.focus = result.focus;
  if (result.recovery) compact.recovery = result.recovery;
  return compact;
}

export function compactTransaction(
  result: TransactionResult,
): CompactResult & { rolledBack: boolean; recovery?: TransactionResult["recovery"] } {
  const compact: CompactResult & { rolledBack: boolean; recovery?: TransactionResult["recovery"] } = {
    status: result.status,
    revision: result.revision,
    effects: result.effects,
    rolledBack: result.rolledBack,
  };
  if (result.issues) compact.issues = result.issues;
  if (result.recovery) compact.recovery = result.recovery;
  return compact;
}
