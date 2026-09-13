import { diffStates, focusFor } from "../ir/diff.js";
import { cloneJson, normalizeAction } from "../ir/normalize.js";
import { validateAction } from "../ir/validate.js";
import type {
  Action,
  ActionResult,
  AdapterState,
  RevisionRecord,
  State,
  StateQuery,
  ValidationIssue,
} from "../ir/types.js";
import type { Adapter } from "./adapter.js";

function stamp(inner: AdapterState, revision: number): State {
  const state: State = {
    revision,
    objects: cloneJson(inner.objects),
    selection: cloneJson(inner.selection),
  };
  if (inner.meta !== undefined) {
    state.meta = cloneJson(inner.meta);
  }
  return state;
}

function issue(code: string, message: string): ValidationIssue {
  return { code, message };
}

export class Session {
  private current = 0;
  private readonly snapshots: AdapterState[] = [];
  private readonly log: RevisionRecord[] = [];

  constructor(private readonly adapter: Adapter) {
    this.snapshots.push(cloneJson(adapter.snapshot()));
  }

  catalog() {
    return this.adapter.catalog();
  }

  snapshot(query?: StateQuery): State {
    const inner = query ? this.adapter.snapshot(query) : this.snapshots[this.current];
    return stamp(inner ?? this.adapter.snapshot(), this.current);
  }

  history(): RevisionRecord[] {
    return cloneJson(this.log);
  }

  apply(raw: unknown): ActionResult {
    let action: Action;
    try {
      action = normalizeAction(raw);
    } catch (error) {
      const before = this.snapshot();
      const message = error instanceof Error ? error.message : "Malformed action";
      return {
        status: "rejected",
        action: { action: "", params: {} },
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [issue("malformed_action", message)],
      };
    }

    const before = this.snapshot();
    const issues = [
      ...validateAction(action, before, this.adapter.catalog()),
      ...(this.adapter.check?.(action, before) ?? []),
    ];

    if (issues.length > 0) {
      const rejected: ActionResult = {
        status: "rejected",
        action,
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues,
      };
      const rejectedFocus = focusFor(action, before, before);
      if (rejectedFocus) rejected.focus = rejectedFocus;
      return rejected;
    }

    try {
      const outcome = this.adapter.execute(action, before);
      const afterInner = this.adapter.snapshot();
      const after = stamp(afterInner, this.current + 1);
      const effects = outcome.effects?.length ? outcome.effects : diffStates(before, after);

      this.current += 1;
      this.snapshots.push(cloneJson(afterInner));
      this.log.push({
        revision: this.current,
        timestamp: new Date().toISOString(),
        action,
        effects,
      });

      const accepted: ActionResult = {
        status: "accepted",
        action,
        revision: this.current,
        before,
        after,
        effects,
      };
      const acceptedFocus = focusFor(action, before, after);
      if (acceptedFocus) accepted.focus = acceptedFocus;
      return accepted;
    } catch (error) {
      this.adapter.restore(cloneJson(this.snapshots[this.current]!));
      const after = this.snapshot();
      const message = error instanceof Error ? error.message : "Adapter execution failed";
      const failed: ActionResult = {
        status: "failed",
        action,
        revision: this.current,
        before,
        after,
        effects: [],
        issues: [issue("execution_failed", message)],
      };
      const failedFocus = focusFor(action, before, after);
      if (failedFocus) failed.focus = failedFocus;
      return failed;
    }
  }

  rollback(to: number): ActionResult {
    const action: Action = { action: "rollback", params: { revision: to } };
    const before = this.snapshot();

    if (!Number.isInteger(to) || to < 0 || to > this.current) {
      return {
        status: "rejected",
        action,
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [
          issue(
            "invalid_revision",
            `Cannot rollback to revision ${to}; current revision is ${this.current}`,
          ),
        ],
      };
    }

    const restored = cloneJson(this.snapshots[to]!);
    this.adapter.restore(restored);
    this.current = to;
    this.snapshots.length = to + 1;
    this.log.splice(0, this.log.length, ...this.log.filter((entry) => entry.revision <= to));
    const after = this.snapshot();

    return {
      status: "accepted",
      action,
      revision: this.current,
      before,
      after,
      effects: diffStates(before, after),
    };
  }
}
