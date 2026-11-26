import type { Action, ActionResult, ValidationIssue } from "../../src/index.js";
import { LOCKED_TARGET_POLICY, Session, normalizeAction, sameJson } from "../../src/index.js";
import {
  createSlidesAdapter,
  documentFromSnapshot,
  emptyTrace,
  finishTask,
  type ExecutionTrace,
} from "../invariants.js";
import type { EvalDriver, EvalPlanStep, EvalTask, EvalTaskResult, TokenUsage } from "../types.js";

const WRITE_OPS = new Set([
  "set_text",
  "set_fill",
  "set_locked",
  "move",
  "resize",
  "align",
  "duplicate",
  "bring_to_front",
  "send_to_back",
  "delete",
  "set_active_slide",
  "ungroup",
]);

interface StepOutcome {
  status: "accepted" | "rejected" | "failed";
  actionName: string;
  issues: string[];
  rolledBack: boolean;
}

function codes(issues: ValidationIssue[] | undefined): string[] {
  return (issues ?? []).map((issue) => issue.code);
}

function outcomeFrom(result: ActionResult, rolledBack = false): StepOutcome {
  return {
    status: result.status,
    actionName: result.action.action,
    issues: codes(result.issues),
    rolledBack,
  };
}

class ScopedPolicySession {
  private readonly blockedUnlock: boolean;

  constructor(
    private readonly session: Session,
    private readonly task: EvalTask,
  ) {
    this.blockedUnlock = (task.forbidLockedMutation ?? true) && LOCKED_TARGET_POLICY === "report_failed";
  }

  snapshot() {
    return this.session.snapshot();
  }

  metrics() {
    return this.session.metrics();
  }

  private policyIssues(action: Action): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const allow = this.task.allowedWriteIds;
    if (allow && WRITE_OPS.has(action.action)) {
      if (!action.target || !allow.includes(action.target)) {
        issues.push({
          code: "out_of_scope",
          message: `Write to "${action.target ?? "(none)"}" is outside allowedWriteIds`,
          path: "target",
        });
      }
    }
    if (allow && action.action === "create_shape") {
      const parent =
        typeof action.params.parent === "string" ? action.params.parent : this.activeSlide();
      if (!allow.includes(parent)) {
        issues.push({
          code: "out_of_scope",
          message: `create_shape parent "${parent}" is outside allowedWriteIds`,
          path: "parent",
        });
      }
    }
    if (allow && action.action === "group" && Array.isArray(action.params.ids)) {
      for (const id of action.params.ids) {
        if (typeof id === "string" && !allow.includes(id)) {
          issues.push({
            code: "out_of_scope",
            message: `group member "${id}" is outside allowedWriteIds`,
            path: "ids",
          });
        }
      }
    }
    if (
      this.blockedUnlock &&
      action.action === "set_locked" &&
      action.params.value === false &&
      action.target &&
      this.isLocked(action.target)
    ) {
      issues.push({
        code: "locked",
        message: `LOCKED_TARGET_POLICY=${LOCKED_TARGET_POLICY} forbids unlocking "${action.target}"`,
        path: "properties.locked",
      });
    }
    return issues;
  }

  private activeSlide(): string {
    const active = this.session.snapshot().meta?.activeSlide;
    return typeof active === "string" ? active : "";
  }

  private isLocked(id: string): boolean {
    return this.session.snapshot().objects.find((object) => object.id === id)?.properties.locked === true;
  }

  private reject(action: Action, issues: ValidationIssue[]): StepOutcome {
    return { status: "rejected", actionName: action.action, issues: codes(issues), rolledBack: false };
  }

  sync(): StepOutcome {
    return outcomeFrom(this.session.sync());
  }

  apply(raw: unknown): StepOutcome {
    let action: Action;
    try {
      action = normalizeAction(raw);
    } catch {
      return outcomeFrom(this.session.apply(raw));
    }
    if (action.action === "sync") return this.sync();
    if (action.action === "undo") return outcomeFrom(this.session.undo());
    const issues = this.policyIssues(action);
    if (issues.length > 0) return this.reject(action, issues);
    return outcomeFrom(this.session.apply(raw));
  }

  transaction(actions: unknown[]): StepOutcome {
    const start = this.session.snapshot().revision;
    const issues: string[] = [];
    for (const raw of actions) {
      const outcome = this.apply(raw);
      issues.push(...outcome.issues);
      if (outcome.status === "accepted") continue;
      let rolledBack = false;
      if (this.session.snapshot().revision !== start) {
        const restored = this.session.rollback(start);
        rolledBack = restored.status === "accepted";
        issues.push(...codes(restored.issues));
      }
      return { status: outcome.status, actionName: "transaction", issues, rolledBack };
    }
    return { status: "accepted", actionName: "transaction", issues, rolledBack: false };
  }
}

export interface ScirRunOptions {
  driver?: EvalDriver;
  plan?: EvalPlanStep[];
  schemaViolation?: string;
  tokenUsage?: TokenUsage | null;
  latencyMs?: number;
  loopRepeat?: boolean;
  contextOverflow?: boolean;
}

function signature(value: unknown): string {
  return JSON.stringify(value);
}

export function runScirTask(task: EvalTask, options: ScirRunOptions = {}): EvalTaskResult {
  const driver = options.driver ?? "deterministic-harness";
  const started = performance.now();
  const adapter = createSlidesAdapter(task.preset);
  const session = new Session(adapter);
  const policy = new ScopedPolicySession(session, task);
  const initial = documentFromSnapshot(session.snapshot());
  const trace = emptyTrace();
  const plan = options.plan ?? task.scirPlan;

  if (options.schemaViolation !== undefined) {
    trace.schemaViolation = true;
    trace.errorMessage = options.schemaViolation;
  } else if (options.contextOverflow === true) {
    trace.contextOverflow = true;
    trace.errorMessage = "context overflow";
  } else {
    runPlan(task, adapter, policy, plan, trace);
  }
  if (options.loopRepeat === true) trace.loopRepeat = true;

  const latencyMs = options.latencyMs ?? performance.now() - started;
  return finishTask({
    task,
    policy: "scir",
    driver,
    initial,
    finalDocument: documentFromSnapshot(session.snapshot()),
    trace,
    latencyMs,
    tokenUsage: options.tokenUsage ?? null,
    metrics: session.metrics(),
  });
}

function runPlan(
  task: EvalTask,
  adapter: ReturnType<typeof createSlidesAdapter>,
  policy: ScopedPolicySession,
  plan: EvalPlanStep[],
  trace: ExecutionTrace,
): void {
  const planInjects = plan.some((step) => step.op === "host_inject");
  const auto = !planInjects && task.hostInject !== undefined;
  let drifted = false;
  let injected = false;
  const signatures: string[] = [];

  const performInject = () => {
    if (!task.hostInject) throw new Error(`Task ${task.id} has no hostInject`);
    const spec = task.hostInject;
    adapter.execute(
      normalizeAction({
        action: spec.action,
        ...(spec.target !== undefined ? { target: spec.target } : {}),
        params: spec.params,
      }),
      policy.snapshot(),
    );
    drifted = true;
    injected = true;
  };

  const maybeAuto = () => {
    const trigger = task.hostInject?.trigger;
    if (!auto || !trigger || injected) return;
    const object = policy.snapshot().objects.find((item) => item.id === trigger.id);
    const value = object?.properties[trigger.property];
    if (value === undefined || !sameJson(value, trigger.equals)) return;
    performInject();
  };

  const noteRepeat = (value: unknown) => {
    signatures.push(signature(value));
    if (signatures.length < 3) return;
    const tail = signatures.slice(-3);
    if (tail.every((item) => item === tail[0])) trace.loopRepeat = true;
  };

  const observe = (outcome: StepOutcome) => {
    trace.issueCodes.push(...outcome.issues);
    if (outcome.actionName === "sync" && outcome.status === "accepted" && drifted) {
      trace.syncedDrift = true;
      drifted = false;
      return;
    }
    if (outcome.status === "accepted" && drifted && outcome.actionName !== "sync") {
      trace.wroteWhileDrifted = true;
    }
  };

  if (auto && task.hostInject && !task.hostInject.trigger) performInject();

  for (const step of plan) {
    if (step.op === "host_inject") {
      performInject();
      continue;
    }
    if (step.op === "sync") {
      observe(policy.sync());
      continue;
    }
    if (step.op === "undo") {
      observe(policy.apply({ action: "undo", params: {} }));
      continue;
    }
    if (step.op === "apply") {
      noteRepeat(step.action);
      const outcome = policy.apply(step.action);
      observe(outcome);
      if (outcome.status === "accepted") maybeAuto();
      continue;
    }
    noteRepeat(step.actions);
    const outcome = policy.transaction(step.actions);
    trace.rolledBack = outcome.rolledBack;
    observe(outcome);
  }
}
