import { TASK_CATEGORIES, isTaskCategory, type TaskCategory } from "./policy.js";
import { COMPARE_TASK_IDS, isCompareTaskId, type CompareTaskId } from "./protocol.js";
import { COMPARE_REPEATS, type CompareDriver } from "./settings.js";
import type { CompareRunLog } from "./run.js";

export const COMPARE_OVERALL_WARNING =
  "합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함";

export const SPREAD_MARK = "spread";

export interface CompareCliOptions {
  dryRun: boolean;
  repeats: number;
  driver: CompareDriver;
  adapter: "slides" | "impress" | "all";
  category?: TaskCategory;
  tasks?: CompareTaskId[];
}

export function parseCompareArgs(argv: string[]): CompareCliOptions {
  const category = parseCompareCategory(argv);
  const tasks = parseCompareTasks(argv);
  const dryRun = argv.includes("--dry-run") || process.env.SCIR_COMPARE_DRY_RUN === "1";
  const scripted = argv.includes("--scripted") || process.env.SCIR_COMPARE_DRIVER === "scripted";
  const live = argv.includes("--live") || process.env.SCIR_COMPARE_DRIVER === "live";
  const repeatsFlag = argv.find((arg) => arg.startsWith("--repeats="));
  const adapterFlag = argv.find((arg) => arg.startsWith("--adapter="));
  const adapterRaw = adapterFlag?.slice("--adapter=".length) ?? process.env.SCIR_COMPARE_ADAPTER;
  const adapter = adapterRaw === "slides" || adapterRaw === "impress" || adapterRaw === "all" ? adapterRaw : "all";
  let repeats = COMPARE_REPEATS;
  const repeatsEnv = process.env.SCIR_COMPARE_REPEATS;
  if (repeatsEnv) {
    const parsed = Number(repeatsEnv);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error("SCIR_COMPARE_REPEATS must be a positive integer");
    repeats = parsed;
  }
  if (repeatsFlag) {
    const parsed = Number(repeatsFlag.slice("--repeats=".length));
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--repeats must be a positive integer");
    repeats = parsed;
  }
  if (dryRun) repeats = 1;
  const driver: CompareDriver = scripted && !live ? "scripted" : "live";
  const options: CompareCliOptions = { dryRun, repeats, driver, adapter };
  if (category) options.category = category;
  if (tasks) options.tasks = tasks;
  return options;
}

export function parseCompareTasks(argv: string[]): CompareTaskId[] | undefined {
  const flags = argv.filter((arg) => arg.startsWith("--task="));
  const fromFlags = flags.flatMap((flag) => flag.slice("--task=".length).split(","));
  const fromEnv = process.env.SCIR_COMPARE_TASKS?.split(",") ?? [];
  const raw = (flags.length > 0 ? fromFlags : fromEnv).map((id) => id.trim()).filter(Boolean);
  if (raw.length === 0) return undefined;
  const tasks: CompareTaskId[] = [];
  for (const id of raw) {
    if (!isCompareTaskId(id)) {
      throw new Error(`unknown task "${id}". Use ${COMPARE_TASK_IDS.join(", ")}`);
    }
    if (!tasks.includes(id)) tasks.push(id);
  }
  return tasks;
}

export function parseCompareCategory(argv: string[]): TaskCategory | undefined {
  const flag = argv.find((arg) => arg.startsWith("--category="));
  if (!flag) return undefined;
  const name = flag.slice("--category=".length);
  if (!isTaskCategory(name)) {
    throw new Error(`unknown category "${name}". Use ${TASK_CATEGORIES.join(", ")}`);
  }
  return name;
}

export interface RepeatStats {
  n: number;
  wins: number;
  rate: string;
  stdev: number;
  stepMean: number;
  stepStdev: number;
}

export function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function repeatStats(logs: CompareRunLog[], task: string, policy: "structured" | "vision"): RepeatStats {
  const subset = logs.filter((log) => log.task === task && log.policy === policy);
  const wins = subset.filter((log) => log.metrics.verdict === "DONE").length;
  const bits = subset.map((log) => (log.metrics.verdict === "DONE" ? 1 : 0));
  const steps = subset.map((log) => log.metrics.steps);
  const stepMean = steps.length ? steps.reduce((sum, value) => sum + value, 0) / steps.length : 0;
  return {
    n: subset.length,
    wins,
    rate: subset.length ? `${wins}/${subset.length}` : "—",
    stdev: sampleStdev(bits),
    stepMean,
    stepStdev: sampleStdev(steps),
  };
}

function fmt(value: number): string {
  return value.toFixed(2);
}

function highlight(task: string, stats: RepeatStats): string {
  if (stats.n > 1 && stats.stdev >= 0.4) return `  ${SPREAD_MARK}`;
  if (task === "contrast_check" && stats.n > 1) return stats.stdev > 0 ? `  ${SPREAD_MARK}` : "";
  return "";
}

function winRate(logs: CompareRunLog[], policy: "structured" | "vision"): string {
  const subset = logs.filter((log) => log.policy === policy);
  if (subset.length === 0) return "—";
  const wins = subset.filter((log) => log.metrics.verdict === "DONE").length;
  return `${wins}/${subset.length}`;
}

function formatCategoryTable(logs: CompareRunLog[], category: TaskCategory): string {
  const rows = logs.filter((log) => log.taskCategory === category);
  const tasks = [...new Set(rows.map((log) => log.task))];
  const header =
    `${"task".padEnd(22)} ${"s_rate".padEnd(8)} ${"s_σ".padEnd(6)} ${"v_rate".padEnd(8)} ${"v_σ".padEnd(6)} ` +
    `${"s_steps".padEnd(10)} v_steps`;
  const lines = [
    `--- ${category} ---`,
    `success  structured ${winRate(rows, "structured")}  vision ${winRate(rows, "vision")}`,
    header,
    "-".repeat(header.length),
  ];
  if (tasks.length === 0) {
    lines.push("(no tasks)");
    return lines.join("\n");
  }
  for (const task of tasks) {
    const structured = repeatStats(rows, task, "structured");
    const vision = repeatStats(rows, task, "vision");
    const mark = highlight(task, structured) || highlight(task, vision);
    lines.push(
      `${task.padEnd(22)} ${structured.rate.padEnd(8)} ${fmt(structured.stdev).padEnd(6)} ${vision.rate.padEnd(8)} ${fmt(vision.stdev).padEnd(6)} ` +
        `${`${fmt(structured.stepMean)}±${fmt(structured.stepStdev)}`.padEnd(10)} ${fmt(vision.stepMean)}±${fmt(vision.stepStdev)}${mark}`,
    );
  }
  return lines.join("\n");
}

function formatOverallTable(logs: CompareRunLog[]): string {
  const header = `${"task".padEnd(22)} ${"structured".padEnd(12)} vision`;
  const lines = [`--- overall ---`, COMPARE_OVERALL_WARNING, header, "-".repeat(header.length)];
  const tasks = [...new Set(logs.map((log) => log.task))];
  for (const task of tasks) {
    const structured = repeatStats(logs, task, "structured");
    const vision = repeatStats(logs, task, "vision");
    const mark = highlight(task, structured) || highlight(task, vision);
    lines.push(`${task.padEnd(22)} ${structured.rate.padEnd(12)} ${vision.rate}${mark}`);
  }
  lines.push(`success  structured ${winRate(logs, "structured")}  vision ${winRate(logs, "vision")}`);
  return lines.join("\n");
}

export function formatCompareTable(
  logs: CompareRunLog[],
  options?: { category?: TaskCategory },
): string {
  if (options?.category) {
    return formatCategoryTable(logs, options.category);
  }
  const sections = TASK_CATEGORIES.map((category) => formatCategoryTable(logs, category));
  sections.push(formatOverallTable(logs));
  return sections.join("\n\n");
}
