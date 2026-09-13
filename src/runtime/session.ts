import { diffStates, focusFor } from "../ir/diff.js";
import { measureState } from "../ir/measure.js";
import { cloneJson, normalizeAction, sameJson } from "../ir/normalize.js";
import { selectRelevant } from "../ir/query.js";
import { validateAction } from "../ir/validate.js";
import type {
  Action,
  ActionResult,
  AdapterDescription,
  AdapterState,
  AttemptRecord,
  Capabilities,
  RecoveryMechanism,
  RevisionRecord,
  RunMetrics,
  State,
  StateQuery,
  StateSize,
  Trace,
  TransactionResult,
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

function issue(code: string, message: string, path?: string): ValidationIssue {
  const next: ValidationIssue = { code, message };
  if (path) next.path = path;
  return next;
}

function toAdapterState(state: Pick<AdapterState, "objects" | "selection"> & { meta?: AdapterState["meta"] }): AdapterState {
  const next: AdapterState = { objects: state.objects, selection: state.selection };
  if (state.meta !== undefined) next.meta = state.meta;
  return next;
}

function sameAdapterState(left: AdapterState, right: AdapterState): boolean {
  return (
    sameJson(left.objects, right.objects) &&
    sameJson(left.selection, right.selection) &&
    sameJson(left.meta ?? null, right.meta ?? null)
  );
}

export class Session {
  private current = 0;
  private readonly snapshots: AdapterState[] = [];
  private readonly log: RevisionRecord[] = [];
  private readonly attemptLog: AttemptRecord[] = [];

  constructor(private readonly adapter: Adapter) {
    this.snapshots.push(cloneJson(adapter.snapshot()));
  }

  get adapterId(): string {
    return this.adapter.id;
  }

  catalog() {
    return this.adapter.catalog();
  }

  /** Live adapter state, stamped with the last revision the IR acknowledged. */
  snapshot(query?: StateQuery): State {
    const inner = query ? this.adapter.snapshot(query) : this.adapter.snapshot();
    return stamp(inner, this.current);
  }

  relevant(): State {
    return selectRelevant(this.snapshot());
  }

  size(): { full: StateSize; relevant: StateSize } {
    return { full: measureState(this.snapshot()), relevant: measureState(this.relevant()) };
  }

  describe(): AdapterDescription {
    const catalog = this.catalog();
    const state = this.snapshot();
    const compensation = typeof this.adapter.inverse === "function";
    const snapshotRestore = this.canRestore();
    const base: Capabilities = {
      transactions: snapshotRestore || compensation,
      compensation,
      snapshotRestore,
      relevantState: selectRelevant(state).objects.length < state.objects.length,
      hierarchy: state.objects.some((object) => object.parent !== undefined),
    };
    return {
      adapter: this.adapter.id,
      domain: this.adapter.domain,
      capabilities: { ...base, ...(this.adapter.capabilities?.() ?? {}) },
      revision: state.revision,
      objectTypes: [...new Set(state.objects.map((object) => object.type))],
      operations: {
        core: catalog.filter((operation) => operation.layer === "core").map((operation) => operation.name),
        domain: catalog.filter((operation) => operation.layer !== "core").map((operation) => operation.name),
      },
    };
  }

  history(): RevisionRecord[] {
    return cloneJson(this.log);
  }

  attempts(): AttemptRecord[] {
    return cloneJson(this.attemptLog);
  }

  metrics(): RunMetrics {
    const attempts = this.attemptLog;
    return {
      attempts: attempts.length,
      accepted: attempts.filter((attempt) => attempt.status === "accepted").length,
      rejected: attempts.filter((attempt) => attempt.status === "rejected").length,
      failed: attempts.filter((attempt) => attempt.status === "failed").length,
      revisions: this.current,
    };
  }

  exportTrace(): Trace {
    return {
      adapter: this.adapter.id,
      domain: this.adapter.domain,
      actions: this.log.map((entry) => cloneJson(entry.action)),
    };
  }

  applyAll(raws: unknown[]): ActionResult[] {
    return raws.map((raw) => this.apply(raw));
  }

  /**
   * Re-acknowledge whatever the host currently has. Use this after the
   * application changed out of band, or after a `host_diverged` rejection.
   */
  sync(): ActionResult {
    const before = stamp(this.acknowledged(), this.current);
    const live = this.adapter.snapshot();
    const action: Action = { action: "sync", params: {} };

    if (sameAdapterState(this.acknowledged(), live)) {
      const after = stamp(live, this.current);
      return this.record({
        status: "accepted",
        action,
        revision: this.current,
        before,
        after,
        effects: [],
      });
    }

    this.current += 1;
    this.snapshots.push(cloneJson(live));
    const after = stamp(live, this.current);
    const effects = diffStates(before, after);
    this.log.push({
      revision: this.current,
      timestamp: new Date().toISOString(),
      action,
      effects,
    });
    return this.record({
      status: "accepted",
      action,
      revision: this.current,
      before,
      after,
      effects,
    });
  }

  /**
   * Apply a batch that either lands completely or leaves no changes behind.
   * Later actions can depend on earlier effects, so actions are validated one at
   * a time. An already-applied prefix is reverted by snapshot when the adapter
   * offers that, otherwise by inverse actions. Inverse-only recovery moves the
   * revision forward. If neither mechanism can restore the prefix, the result
   * says so instead of pretending the batch was atomic.
   */
  transaction(raws: unknown[]): TransactionResult {
    const start = this.current;
    const before = this.snapshot();
    const results: ActionResult[] = [];

    for (const raw of raws) {
      const result = this.apply(raw);
      results.push(result);
      if (result.status === "accepted") continue;

      if (this.current === start) {
        return {
          status: result.status,
          revision: this.current,
          before,
          after: this.snapshot(),
          effects: [],
          results,
          rolledBack: false,
          issues: result.issues ?? [issue("transaction_aborted", "Batch aborted before completion")],
        };
      }

      const recovered = this.revertTo(start);
      const after = this.snapshot();
      const aborted: TransactionResult = {
        status: recovered.ok ? result.status : "failed",
        revision: this.current,
        before,
        after,
        effects: recovered.ok ? [] : diffStates(before, after),
        results,
        rolledBack: recovered.ok,
        issues: recovered.ok
          ? (result.issues ?? [issue("transaction_aborted", "Batch aborted before completion")])
          : [
              ...(result.issues ?? []),
              issue("dirty_state", "Batch aborted and the prefix could not be restored"),
            ],
      };
      if (recovered.ok) aborted.recovery = recovered.recovery;
      return aborted;
    }

    const after = this.snapshot();
    return {
      status: "accepted",
      revision: this.current,
      before,
      after,
      effects: diffStates(before, after),
      results,
      rolledBack: false,
    };
  }

  /**
   * Undo the newest revision. Uses an inverse catalog action when the adapter
   * can express one, and a snapshot restore only when that is a declared capability.
   */
  undo(): ActionResult {
    const before = this.snapshot();
    if (this.current === 0) {
      return this.record({
        status: "rejected",
        action: { action: "undo", params: {} },
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [issue("nothing_to_undo", "Session is already at revision 0")],
      });
    }

    const drift = this.driftIssue(before);
    if (drift) {
      return this.record({
        status: "rejected",
        action: { action: "undo", params: {} },
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [drift],
      });
    }

    const last = this.log[this.log.length - 1];
    const priorInner = this.snapshots[this.current - 1];
    const prior = priorInner ? stamp(priorInner, this.current - 1) : before;
    const inverse = last ? this.adapter.inverse?.(last.action, prior) : undefined;
    if (inverse) {
      const compensated = this.apply(inverse);
      if (compensated.status === "accepted") {
        compensated.recovery = "compensation";
        return compensated;
      }
    }

    if (this.canRestore()) {
      const restored = this.rollback(this.current - 1);
      if (restored.status === "accepted") restored.recovery = "snapshot";
      return restored;
    }

    return this.record({
      status: "rejected",
      action: { action: "undo", params: {} },
      revision: this.current,
      before,
      after: before,
      effects: [],
      issues: [
        issue(
          "unsupported_recovery",
          inverse
            ? "Inverse action was rejected and snapshot restore is not available"
            : "No inverse action, and snapshot restore is not available",
        ),
      ],
    });
  }

  private record(result: ActionResult): ActionResult {
    const attempt: AttemptRecord = {
      status: result.status,
      action: result.action,
      revision: result.revision,
    };
    if (result.issues) attempt.issues = result.issues;
    this.attemptLog.push(attempt);
    return result;
  }

  apply(raw: unknown): ActionResult {
    let action: Action;
    try {
      action = normalizeAction(raw);
    } catch (error) {
      const before = this.snapshot();
      const message = error instanceof Error ? error.message : "Malformed action";
      return this.record({
        status: "rejected",
        action: { action: "", params: {} },
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [issue("malformed_action", message)],
      });
    }

    if (action.action === "sync") {
      return this.sync();
    }

    const before = this.snapshot();
    if (action.action === "rollback") {
      const to = action.params.revision;
      if (typeof to !== "number" || !Number.isInteger(to)) {
        return this.record({
          status: "rejected",
          action,
          revision: this.current,
          before,
          after: before,
          effects: [],
          issues: [issue("invalid_revision", "rollback requires an integer revision")],
        });
      }
      return this.rollback(to);
    }

    if (action.action === "undo") {
      return this.undo();
    }

    const drift = this.driftIssue(before);
    if (drift) {
      return this.record({
        status: "rejected",
        action,
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [drift],
      });
    }

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
      return this.record(rejected);
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
      return this.record(accepted);
    } catch (error) {
      if (this.canRestore()) {
        this.adapter.restore(cloneJson(this.snapshots[this.current]!));
      } else {
        this.snapshots[this.current] = cloneJson(this.adapter.snapshot());
      }
      const after = this.snapshot();
      const message = error instanceof Error ? error.message : "Adapter execution failed";
      const failedIssues = [issue("execution_failed", message)];
      if (!sameAdapterState(toAdapterState(before), toAdapterState(after))) {
        failedIssues.push(issue("dirty_state", "Execution failed and the host still changed"));
      }
      const failed: ActionResult = {
        status: "failed",
        action,
        revision: this.current,
        before,
        after,
        effects: [],
        issues: failedIssues,
      };
      const failedFocus = focusFor(action, before, after);
      if (failedFocus) failed.focus = failedFocus;
      return this.record(failed);
    }
  }

  rollback(to: number): ActionResult {
    const action: Action = { action: "rollback", params: { revision: to } };
    const before = this.snapshot();

    if (!this.canRestore()) {
      return this.record({
        status: "rejected",
        action,
        revision: this.current,
        before,
        after: before,
        effects: [],
        issues: [issue("unsupported_recovery", "Adapter does not offer snapshot restore")],
      });
    }

    if (!Number.isInteger(to) || to < 0 || to > this.current) {
      return this.record({
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
      });
    }

    const restored = cloneJson(this.snapshots[to]!);
    this.adapter.restore(restored);
    this.current = to;
    this.snapshots.length = to + 1;
    this.log.splice(0, this.log.length, ...this.log.filter((entry) => entry.revision <= to));
    const after = this.snapshot();

    return this.record({
      status: "accepted",
      action,
      revision: this.current,
      before,
      after,
      effects: diffStates(before, after),
    });
  }

  private canRestore(): boolean {
    return this.adapter.capabilities?.().snapshotRestore !== false;
  }

  private acknowledged(): AdapterState {
    return this.snapshots[this.current]!;
  }

  private driftIssue(visible: State): ValidationIssue | undefined {
    if (sameAdapterState(this.acknowledged(), toAdapterState(visible))) {
      return undefined;
    }
    return issue(
      "host_diverged",
      "Host state changed outside this session. Call sync before applying more actions.",
    );
  }

  private revertTo(start: number): { ok: true; recovery: RecoveryMechanism } | { ok: false } {
    if (this.canRestore()) {
      const restored = this.rollback(start);
      return restored.status === "accepted" ? { ok: true, recovery: "snapshot" } : { ok: false };
    }

    const accepted = this.log.filter((entry) => entry.revision > start).reverse();
    for (const entry of accepted) {
      const prior = this.snapshots[entry.revision - 1];
      if (!prior) return { ok: false };
      const inverse = this.adapter.inverse?.(entry.action, stamp(prior, entry.revision - 1));
      if (!inverse) return { ok: false };
      const compensated = this.apply(inverse);
      if (compensated.status !== "accepted") return { ok: false };
    }
    return { ok: true, recovery: "compensation" };
  }
}
