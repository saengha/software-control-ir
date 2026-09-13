import { cloneJson } from "../../ir/normalize.js";
import { SlidesAdapter } from "../../adapters/slides.js";
import type { Adapter } from "../../runtime/adapter.js";
import { COMPARE_POLICIES } from "./protocol.js";
import { categoryOf } from "./policy.js";
import { runCompare, type CompareRunLog } from "./run.js";
import { COMPARE_TASKS, type CompareTask } from "./tasks.js";
import type { ModelClient } from "./model.js";
import { runCompareLive } from "./live.js";

export { COMPARE_POLICIES, COMPARE_PROTOCOL, COMPARE_TASK_IDS, STRUCTURED_PROMPT, VISION_PROMPT, catalogToolList, fillComparePrompt, isCompareTaskId } from "./protocol.js";
export { COMPARE_TASKS } from "./tasks.js";
export { bindPolicyAction, observeStructured, observeVision, visionJsonContainsSecrets } from "./observe.js";
export { executeUiAction, visibleChrome, visionToolFeedback } from "./ui.js";
export { runCompare } from "./run.js";
export { runCompareLive } from "./live.js";
export {
  COMPARE_OVERALL_WARNING,
  SPREAD_MARK,
  formatCompareTable,
  parseCompareArgs,
  parseCompareCategory,
  parseCompareTasks,
  repeatStats,
  sampleStdev,
} from "./report.js";
export {
  COMPARE_LIVE_MODEL,
  COMPARE_REPEATS,
  HOST_DRIFT_AFTER_STEPS,
  liveApiKey,
} from "./settings.js";
export { LOCKED_TARGET_POLICY, TASK_CATEGORIES, TASK_CATEGORY, categoryOf, lockedTargetFillAccepted } from "./policy.js";
export { migrateExperimentLog, migrateExperimentLogs } from "./migrate.js";
export {
  contrastRatio,
  encodePpm,
  gradeRenderedContrast,
  renderSlideRaster,
} from "./contrast.js";
export {
  createAnthropicClient,
  createReplayClient,
  withBackoff,
  toolsForPolicy,
} from "./model.js";
export type { CompareMetrics, CompareRunLog, CompareRunOptions, CompareStepLog, CompareVerdict } from "./run.js";
export type { ComparePolicy, CompareTaskId } from "./protocol.js";
export type { CompareFixture, CompareTask } from "./tasks.js";
export type { TaskCategory } from "./policy.js";
export type { ContrastGrade, SlideRaster } from "./contrast.js";
export type { CompareCliOptions, RepeatStats } from "./report.js";
export type { CompareDriver } from "./settings.js";
export type { ModelClient } from "./model.js";

export interface CompareSuiteOptions {
  reset?: () => void;
  prepare?: (task: CompareTask) => void;
  category?: string;
  tasks?: string[];
  repeats?: number;
}

function tasksToRun(options?: { category?: string; tasks?: string[] }): CompareTask[] {
  let tasks = COMPARE_TASKS;
  if (options?.category) {
    tasks = tasks.filter((task) => categoryOf(task.id) === options.category);
  }
  if (options?.tasks?.length) {
    const wanted = new Set(options.tasks);
    tasks = tasks.filter((task) => wanted.has(task.id));
  }
  return tasks;
}

function repeatCount(options?: CompareSuiteOptions): number {
  return options?.repeats && options.repeats > 0 ? options.repeats : 1;
}

export function runCompareSuite(adapter: Adapter, options?: CompareSuiteOptions): CompareRunLog[] {
  const logs: CompareRunLog[] = [];
  const repeats = repeatCount(options);
  for (const task of tasksToRun(options)) {
    for (let runIndex = 0; runIndex < repeats; runIndex += 1) {
      options?.prepare?.(task);
      for (const policy of COMPARE_POLICIES) {
        logs.push(runCompare(adapter, task, policy, { runIndex, driver: "scripted" }));
        options?.reset?.();
      }
    }
  }
  return logs;
}

export async function runCompareSuiteLive(
  adapter: Adapter,
  client: ModelClient,
  options?: CompareSuiteOptions,
): Promise<CompareRunLog[]> {
  const logs: CompareRunLog[] = [];
  const repeats = repeatCount(options);
  for (const task of tasksToRun(options)) {
    for (let runIndex = 0; runIndex < repeats; runIndex += 1) {
      options?.prepare?.(task);
      for (const policy of COMPARE_POLICIES) {
        logs.push(await runCompareLive(adapter, task, policy, client, { runIndex, driver: "live", model: client.model }));
        options?.reset?.();
      }
    }
  }
  return logs;
}

export function runSlidesCompare(options?: { category?: string; tasks?: string[]; repeats?: number }): CompareRunLog[] {
  const logs: CompareRunLog[] = [];
  const repeats = options?.repeats && options.repeats > 0 ? options.repeats : 1;
  for (const task of tasksToRun(options)) {
    for (let runIndex = 0; runIndex < repeats; runIndex += 1) {
      const adapter = new SlidesAdapter({ preset: task.fixture === "contrast" ? "contrast" : "default" });
      const initial = cloneJson(adapter.snapshot());
      for (const policy of COMPARE_POLICIES) {
        logs.push(runCompare(adapter, task, policy, { runIndex, driver: "scripted" }));
        adapter.restore(cloneJson(initial));
      }
    }
  }
  return logs;
}

export async function runSlidesCompareLive(
  client: ModelClient,
  options?: { category?: string; tasks?: string[]; repeats?: number },
): Promise<CompareRunLog[]> {
  const logs: CompareRunLog[] = [];
  const repeats = options?.repeats && options.repeats > 0 ? options.repeats : 1;
  for (const task of tasksToRun(options)) {
    for (let runIndex = 0; runIndex < repeats; runIndex += 1) {
      const adapter = new SlidesAdapter({ preset: task.fixture === "contrast" ? "contrast" : "default" });
      const initial = cloneJson(adapter.snapshot());
      for (const policy of COMPARE_POLICIES) {
        logs.push(
          await runCompareLive(adapter, task, policy, client, { runIndex, driver: "live", model: client.model }),
        );
        adapter.restore(cloneJson(initial));
      }
    }
  }
  return logs;
}
