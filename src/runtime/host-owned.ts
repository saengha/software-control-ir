import type {
  Action,
  Capabilities,
  ExecuteOutcome,
  State,
  StateQuery,
  ValidationIssue,
} from "../ir/types.js";
import type { Adapter } from "./adapter.js";

/**
 * Present an in-memory adapter as a host-owned document: mutations are real,
 * snapshot restore is not a product promise. Inverse actions, when the inner
 * adapter has them, remain available.
 */
export function hostOwned(inner: Adapter): Adapter {
  const adapter: Adapter = {
    id: inner.id,
    domain: inner.domain,
    catalog: () => inner.catalog(),
    snapshot: (query?: StateQuery) => inner.snapshot(query),
    check: (action: Action, state: State): ValidationIssue[] => inner.check?.(action, state) ?? [],
    execute: (action: Action, state: State): ExecuteOutcome => inner.execute(action, state),
    fixtures: () => inner.fixtures(),
    capabilities: (): Partial<Capabilities> => ({ ...inner.capabilities?.(), snapshotRestore: false }),
    restore: () => {
      throw new Error("Host owns this document; snapshot restore is not available");
    },
  };
  if (inner.inverse) {
    adapter.inverse = (action, before) => inner.inverse!(action, before);
  }
  return adapter;
}
