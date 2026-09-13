import { categoryOf } from "./policy.js";
import { COMPARE_TASK_IDS, type CompareTaskId } from "./protocol.js";
import type { CompareRunLog } from "./run.js";

function isTaskId(value: unknown): value is CompareTaskId {
  return typeof value === "string" && (COMPARE_TASK_IDS as readonly string[]).includes(value);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Backfill taskCategory on a v0 (or already-v1) run log. */
export function migrateExperimentLog(log: unknown): CompareRunLog {
  if (!isPlain(log)) {
    throw new Error("experiment log must be an object");
  }
  if (!isTaskId(log.task)) {
    throw new Error(`unknown compare task: ${String(log.task)}`);
  }
  return {
    ...(log as unknown as CompareRunLog),
    taskCategory: categoryOf(log.task),
    runIndex: typeof log.runIndex === "number" ? log.runIndex : 0,
    driver: log.driver === "live" ? "live" : "scripted",
  };
}

export function migrateExperimentLogs(input: unknown): CompareRunLog[] {
  if (Array.isArray(input)) return input.map(migrateExperimentLog);
  return [migrateExperimentLog(input)];
}
