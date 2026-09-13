import { compactResult } from "../../ir/compact.js";
import { cloneJson, normalizeAction } from "../../ir/normalize.js";
import type { CompactResult, State } from "../../ir/types.js";
import type { Adapter } from "../../runtime/adapter.js";
import { Session } from "../../runtime/session.js";
import type { GoalCheck } from "../run.js";
import { bindPolicyAction, observationSize, observeStructured, observeVision, type VisionObservation } from "./observe.js";
import {
  COMPARE_PROTOCOL,
  STRUCTURED_PROMPT,
  VISION_PROMPT,
  catalogToolList,
  fillComparePrompt,
  type ComparePolicy,
} from "./protocol.js";
import { renderSlideRaster } from "./contrast.js";
import { categoryOf } from "./policy.js";
import type { CompareDriver } from "./settings.js";
import type { CompareTask } from "./tasks.js";
import { executeUiAction, isUiAction, resolveUiAction, visibleChrome, type UiChrome } from "./ui.js";

export type CompareVerdict = "DONE" | "FAILED";

export interface CompareObservationSummary {
  kind: ComparePolicy;
  chars: number;
  approxTokens: number;
  objectCount?: number;
  regionCount?: number;
  rasterSha256?: string;
  rasterWidth?: number;
  rasterHeight?: number;
}

export interface CompareStepLog {
  i: number;
  proposed: unknown;
  action: unknown;
  result: CompactResult & { rolledBack?: boolean };
  latencyMs: number;
  observationChars: number;
  observationTokens: number;
}

export interface CompareMetrics {
  attempts: number;
  accepted: number;
  rejected: number;
  failed: number;
  revisions: number;
  steps: number;
  latencyMs: number;
  goal: boolean;
  observationChars: number;
  observationTokens: number;
  hostDiverged: number;
  usedSync: boolean;
  usedRecovery: boolean;
  verdict: CompareVerdict;
}

export interface CompareRunOptions {
  runIndex?: number;
  driver?: CompareDriver;
  model?: string;
}

function captureRaster(
  adapter: Adapter,
  state: State,
  preferHost: boolean,
): ReturnType<typeof renderSlideRaster> {
  if (preferHost) {
    const host = adapter as Adapter & { exportRaster?: () => unknown };
    try {
      host.exportRaster?.();
    } catch {
      // Host PNG is a render hook, not the grader. Verdict stays on the canvas raster.
    }
  }
  return renderSlideRaster(state);
}

export function taskGoalHolds(adapter: Adapter, session: Session, task: CompareTask): boolean {
  const state = session.snapshot();
  const raster = captureRaster(adapter, state, task.gradeFromRender === true);
  return task.goal(state, { raster }).every((check) => check.ok);
}

export interface CompareRunLog {
  protocol: typeof COMPARE_PROTOCOL.id;
  protocolVersion: typeof COMPARE_PROTOCOL.version;
  adapter: string;
  task: string;
  taskCategory: ReturnType<typeof categoryOf>;
  policy: ComparePolicy;
  driver: CompareDriver;
  runIndex: number;
  model?: string;
  hostDriftAfterSteps?: number;
  goalText: string;
  prompt: string;
  maxSteps: number;
  startedAt: string;
  finishedAt: string;
  observation: CompareObservationSummary;
  steps: CompareStepLog[];
  metrics: CompareMetrics;
  checks: GoalCheck[];
}

export function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueCodes(result: CompactResult): string[] {
  return (result.issues ?? []).map((issue) => issue.code);
}

export function summarizeObservation(
  policy: ComparePolicy,
  session: Session,
  vision: VisionObservation | undefined,
  state: State,
): CompareObservationSummary {
  if (policy === "structured") {
    const observed = observeStructured(state, session.catalog());
    const size = observationSize(observed);
    return {
      kind: "structured",
      chars: size.chars,
      approxTokens: size.approxTokens,
      objectCount: observed.state.objects.length,
    };
  }
  if (!vision) throw new Error("vision observation missing");
  const size = observationSize(vision);
  return {
    kind: "vision",
    chars: size.chars,
    approxTokens: size.approxTokens,
    regionCount: vision.regions.length,
    rasterSha256: vision.raster.sha256,
    rasterWidth: vision.raster.width,
    rasterHeight: vision.raster.height,
  };
}

export function injectHostIfDue(
  adapter: Adapter,
  session: Session,
  task: CompareTask,
  stepsTaken: number,
  already: boolean,
): boolean {
  if (already || !task.inject) return already;
  const due = task.injectWhen
    ? task.injectWhen(session.snapshot())
    : task.injectAfterSteps === undefined || stepsTaken >= task.injectAfterSteps;
  if (!due) return false;
  adapter.execute(normalizeAction({ ...task.inject }), session.snapshot());
  return true;
}

export function performCompareStep(
  session: Session,
  policy: ComparePolicy,
  proposed: unknown,
  chrome: UiChrome,
): {
  result: CompactResult & { rolledBack?: boolean };
  bound: unknown;
  chrome: UiChrome;
  size: { chars: number; approxTokens: number };
} {
  const live = session.snapshot();
  const vision = policy === "vision" ? observeVision(live) : undefined;
  const observed = policy === "structured" ? observeStructured(live, session.catalog()) : vision!;
  const chromeChars = policy === "vision" ? JSON.stringify(visibleChrome(live, chrome)).length : 0;
  const size = {
    chars: observationSize(observed).chars + chromeChars,
    approxTokens: Math.ceil((observationSize(observed).chars + chromeChars) / 4),
  };

  if (policy === "vision") {
    if (!isUiAction(proposed)) {
      throw new Error("vision policy must issue click/type/scroll/right_click/screenshot");
    }
    const resolved = vision ? resolveUiAction(proposed, vision) : proposed;
    const ui = executeUiAction(session, chrome, resolved);
    return { result: ui.result, bound: ui.bound, chrome: ui.chrome, size };
  }

  const bound = bindPolicyAction("structured", proposed, live, undefined);
  return { result: compactResult(session.apply(bound)), bound, chrome, size };
}

function usesSync(step: CompareStepLog): boolean {
  if (isPlain(step.action) && step.action.action === "sync") return true;
  if (isPlain(step.proposed) && step.proposed.action === "sync") return true;
  if (isPlain(step.proposed) && step.proposed.name === "scir.sync") return true;
  return false;
}

function namesOf(step: CompareStepLog): string[] {
  const names: string[] = [];
  for (const value of [step.action, step.proposed]) {
    if (!isPlain(value)) continue;
    for (const key of ["action", "name", "tool"] as const) {
      const name = value[key];
      if (typeof name === "string") names.push(name);
    }
  }
  return names;
}

function isHostDriftRetry(step: CompareStepLog): boolean {
  return namesOf(step).some((name) => name.includes("set_text") || name.includes("set_fill") || name === "type");
}

function retriedAfterSync(steps: CompareStepLog[]): boolean {
  let synced = false;
  for (const step of steps) {
    if (usesSync(step) && step.result.status === "accepted") {
      synced = true;
      continue;
    }
    if (synced && step.result.status === "accepted" && isHostDriftRetry(step)) return true;
  }
  return false;
}

function hostDriftRecovered(steps: CompareStepLog[], stateGoal: boolean): boolean {
  const diverged = steps.some((step) => issueCodes(step.result).includes("host_diverged"));
  const synced = steps.some((step) => usesSync(step) && step.result.status === "accepted");
  return stateGoal && diverged && synced && retriedAfterSync(steps);
}

export function finishCompareLog(input: {
  adapter: Adapter;
  task: CompareTask;
  policy: ComparePolicy;
  session: Session;
  prompt: string;
  steps: CompareStepLog[];
  observation: CompareObservationSummary;
  startedAt: string;
  started: number;
  options?: CompareRunOptions;
}): CompareRunLog {
  const { adapter, task, policy, session, prompt, steps, observation, startedAt, started, options } = input;
  const finalState = session.snapshot();
  const raster = captureRaster(adapter, finalState, task.gradeFromRender === true);
  const checks = task.goal(finalState, { raster });
  const stateGoal = checks.every((check) => check.ok);
  const codes = steps.flatMap((step) => issueCodes(step.result));
  const counts = session.metrics();
  const recovered = task.id === "host_drift" ? hostDriftRecovered(steps, stateGoal) : stateGoal;
  const metrics: CompareMetrics = {
    attempts: counts.attempts,
    accepted: counts.accepted,
    rejected: counts.rejected,
    failed: counts.failed,
    revisions: counts.revisions,
    steps: steps.length,
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
    goal: recovered,
    observationChars: observation.chars,
    observationTokens: observation.approxTokens,
    hostDiverged: codes.filter((code) => code === "host_diverged").length,
    usedSync: steps.some((step) => usesSync(step)),
    usedRecovery: steps.some((step) => step.result.recovery !== undefined),
    verdict: recovered ? "DONE" : "FAILED",
  };

  const log: CompareRunLog = {
    protocol: COMPARE_PROTOCOL.id,
    protocolVersion: COMPARE_PROTOCOL.version,
    adapter: adapter.id,
    task: task.id,
    taskCategory: categoryOf(task.id),
    policy,
    driver: options?.driver ?? "scripted",
    runIndex: options?.runIndex ?? 0,
    goalText: task.goalText,
    prompt,
    maxSteps: task.maxSteps,
    startedAt,
    finishedAt: new Date().toISOString(),
    observation,
    steps,
    metrics,
    checks,
  };
  if (options?.model) log.model = options.model;
  if (task.injectAfterSteps !== undefined) log.hostDriftAfterSteps = task.injectAfterSteps;
  return log;
}

export function comparePrompt(session: Session, task: CompareTask, policy: ComparePolicy): string {
  return fillComparePrompt(policy === "structured" ? STRUCTURED_PROMPT : VISION_PROMPT, {
    catalog: catalogToolList(session.catalog()),
    goal: task.goalText,
    n: task.maxSteps,
  });
}

export function runCompare(
  adapter: Adapter,
  task: CompareTask,
  policy: ComparePolicy,
  options?: CompareRunOptions,
): CompareRunLog {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const session = new Session(adapter);
  const prompt = comparePrompt(session, task, policy);
  let injected = injectHostIfDue(adapter, session, task, 0, false);

  const opening = session.snapshot();
  const openingVision = policy === "vision" ? observeVision(opening) : undefined;
  const observation = summarizeObservation(policy, session, openingVision, opening);
  const steps: CompareStepLog[] = [];
  const script = task.script(policy, { adapterId: adapter.id });
  let chrome: UiChrome = {};

  for (const proposed of script) {
    if (steps.length >= task.maxSteps) break;
    const stepStarted = performance.now();
    const done = performCompareStep(session, policy, proposed, chrome);
    chrome = done.chrome;
    steps.push({
      i: steps.length,
      proposed: cloneJson(proposed),
      action: cloneJson(done.bound),
      result: done.result,
      latencyMs: Math.round((performance.now() - stepStarted) * 100) / 100,
      observationChars: done.size.chars,
      observationTokens: done.size.approxTokens,
    });
    injected = injectHostIfDue(adapter, session, task, steps.length, injected);
  }

  const runOptions: CompareRunOptions = {
    driver: options?.driver ?? "scripted",
    runIndex: options?.runIndex ?? 0,
  };
  if (options?.model) runOptions.model = options.model;
  return finishCompareLog({
    adapter,
    task,
    policy,
    session,
    prompt,
    steps,
    observation,
    startedAt,
    started,
    options: runOptions,
  });
}
