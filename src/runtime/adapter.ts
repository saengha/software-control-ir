import type {
  Action,
  AdapterState,
  Capabilities,
  ExecuteOutcome,
  Operation,
  State,
  StateQuery,
  ValidationIssue,
} from "../ir/types.js";

export interface Adapter {
  readonly id: string;
  readonly domain: string;
  catalog(): Operation[];
  snapshot(query?: StateQuery): AdapterState;
  check?(action: Action, state: State): ValidationIssue[];
  execute(action: Action, state: State): ExecuteOutcome;
  restore(state: AdapterState): void;
  /**
   * A catalog action that undoes `action`, when the adapter can express one.
   * Returning undefined tells the session to fall back to a snapshot restore.
   */
  inverse?(action: Action, before: State): Action | undefined;
  capabilities?(): Partial<Capabilities>;
  fixtures(): {
    validAction: Action;
    invalidAction: Action;
  };
}
