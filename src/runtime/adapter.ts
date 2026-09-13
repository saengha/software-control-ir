import type {
  Action,
  AdapterState,
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
  fixtures(): {
    validAction: Action;
    invalidAction: Action;
  };
}
