import type { RunMetrics, State } from "../ir/types.js";
import type { Adapter } from "../runtime/adapter.js";
import { Session } from "../runtime/session.js";

export interface GoalCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface PolicyRun {
  policy: string;
  metrics: RunMetrics;
  checks: GoalCheck[];
}

export function summarize(session: Session, started: number, checks: GoalCheck[]): PolicyRun["metrics"] {
  const metrics: RunMetrics = {
    ...session.metrics(),
    latencyMs: performance.now() - started,
    goal: checks.every((check) => check.ok),
  };
  return metrics;
}

export function runActions(
  policy: string,
  adapter: Adapter,
  actions: unknown[],
  goal: (state: State) => GoalCheck[],
): PolicyRun {
  const started = performance.now();
  const session = new Session(adapter);
  session.applyAll(actions);
  const checks = goal(session.snapshot());
  return { policy, metrics: summarize(session, started, checks), checks };
}
