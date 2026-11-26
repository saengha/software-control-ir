import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { linearQuantile, mean } from "./report.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const V4_RESULT_FILES = [
  "results/2026-09-13-slides-gemini-3.6-flash-n5-all.json",
  "results/2026-09-14-slides-Qwen3.8-27B-n5-all.json",
  "results/2026-09-15-slides-claude-haiku-4-5-20251001-n5-all.json",
  "results/2026-09-15-impress-gemini-3.6-flash-n5-all.json",
] as const;

interface RawIssue {
  code: string;
  message: string;
}

interface RawStep {
  i: number;
  action: unknown;
  status: string;
  issues: RawIssue[];
  latencyMs: number;
}

interface RawCheck {
  id: string;
  ok: boolean;
  detail?: string;
}

interface RawRun {
  file: string;
  protocol: string;
  protocolVersion: number;
  adapter: string;
  task: string;
  taskCategory: string;
  policy: "structured" | "vision";
  model: string;
  runIndex: number;
  steps: RawStep[];
  goal: boolean;
  verdict: string;
  latencyMs: number;
  observationTokens: number;
  stepCount: number;
  checks: RawCheck[];
}

export interface V4Rate {
  passed: number;
  total: number;
  rate: string;
}

export interface V4PolicyMetrics {
  rate: V4Rate;
  latencyMs: { p50: number; p95: number; mean: number };
  observationTokens: { mean: number; p95: number };
  meanSteps: number;
  issueCodes: Record<string, number>;
}

export interface V4FileSummary {
  file: string;
  model: string;
  adapter: string;
  protocol: string;
  protocolVersion: number;
  runs: number;
  structured: V4Rate;
  vision: V4Rate;
  byPolicy: {
    structured: V4PolicyMetrics;
    vision: V4PolicyMetrics;
  };
  byCategory: Record<string, { structured: V4Rate; vision: V4Rate }>;
  byTask: Array<{ task: string; category: string; structured: V4Rate; vision: V4Rate }>;
  latencyMs: { p50: number; p95: number; mean: number };
  observationTokens: { mean: number; p95: number };
  meanSteps: number;
  issueCodes: Record<string, number>;
  failedRuns: number;
}

export interface V4FailureTrace {
  file: string;
  model: string;
  adapter: string;
  task: string;
  taskCategory: string;
  policy: "structured" | "vision";
  runIndex: number;
  verdict: string;
  goal: boolean;
  latencyMs: number;
  issueCodes: string[];
  failedChecks: Array<{ id: string; detail?: string }>;
  steps: Array<{ i: number; status: string; action: string; issues: string[] }>;
}

export interface V4Summary {
  protocol: "scir-compare-v0";
  protocolVersion: 4;
  source: "committed live logs";
  totalRuns: number;
  files: V4FileSummary[];
  failureTraces: V4FailureTrace[];
}

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} is not an object`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
  return value;
}

function rate(passed: number, total: number): V4Rate {
  if (total === 0) fail("cannot rate an empty run group");
  return { passed, total, rate: `${passed}/${total}` };
}

function actionLabel(action: unknown): string {
  if (typeof action !== "object" || action === null) return String(action);
  const record = action as Record<string, unknown>;
  if (typeof record.action === "string") {
    return typeof record.target === "string" ? `${record.action} ${record.target}` : record.action;
  }
  if (typeof record.tool === "string") return record.tool;
  const text = JSON.stringify(action);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function parseRun(value: unknown, file: string, index: number): RawRun {
  const path = `${file}[${index}]`;
  const record = asRecord(value, path);
  const metrics = asRecord(record.metrics, `${path}.metrics`);
  const policy = asString(record.policy, `${path}.policy`);
  if (policy !== "structured" && policy !== "vision") fail(`${path}.policy is ${policy}`);
  if (!Array.isArray(record.steps)) fail(`${path}.steps must be an array`);
  if (!Array.isArray(record.checks)) fail(`${path}.checks must be an array`);
  const steps: RawStep[] = record.steps.map((step, stepIndex) => {
    const stepRecord = asRecord(step, `${path}.steps[${stepIndex}]`);
    const result = asRecord(stepRecord.result, `${path}.steps[${stepIndex}].result`);
    const issues: RawIssue[] = [];
    if (result.issues !== undefined) {
      if (!Array.isArray(result.issues)) fail(`${path}.steps[${stepIndex}].result.issues must be an array`);
      for (const issue of result.issues) {
        const issueRecord = asRecord(issue, `${path}.steps[${stepIndex}].result.issues`);
        issues.push({
          code: asString(issueRecord.code, `${path} issue code`),
          message: typeof issueRecord.message === "string" ? issueRecord.message : "",
        });
      }
    }
    return {
      i: asNumber(stepRecord.i, `${path}.steps[${stepIndex}].i`),
      action: stepRecord.action,
      status: asString(result.status, `${path}.steps[${stepIndex}].result.status`),
      issues,
      latencyMs: asNumber(stepRecord.latencyMs, `${path}.steps[${stepIndex}].latencyMs`),
    };
  });
  const checks: RawCheck[] = record.checks.map((check, checkIndex) => {
    const checkRecord = asRecord(check, `${path}.checks[${checkIndex}]`);
    const parsed: RawCheck = {
      id: asString(checkRecord.id, `${path}.checks[${checkIndex}].id`),
      ok: asBoolean(checkRecord.ok, `${path}.checks[${checkIndex}].ok`),
    };
    if (typeof checkRecord.detail === "string") parsed.detail = checkRecord.detail;
    return parsed;
  });
  return {
    file,
    protocol: asString(record.protocol, `${path}.protocol`),
    protocolVersion: asNumber(record.protocolVersion, `${path}.protocolVersion`),
    adapter: asString(record.adapter, `${path}.adapter`),
    task: asString(record.task, `${path}.task`),
    taskCategory: asString(record.taskCategory, `${path}.taskCategory`),
    policy,
    model: asString(record.model, `${path}.model`),
    runIndex: asNumber(record.runIndex, `${path}.runIndex`),
    steps,
    goal: asBoolean(metrics.goal, `${path}.metrics.goal`),
    verdict: asString(metrics.verdict, `${path}.metrics.verdict`),
    latencyMs: asNumber(metrics.latencyMs, `${path}.metrics.latencyMs`),
    observationTokens: asNumber(metrics.observationTokens, `${path}.metrics.observationTokens`),
    stepCount: asNumber(metrics.steps, `${path}.metrics.steps`),
    checks,
  };
}

function loadRuns(root: string, file: string): RawRun[] {
  const absolute = join(root, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Could not read ${file}: ${message}`);
  }
  if (!Array.isArray(parsed)) fail(`${file} must be a JSON array`);
  return parsed.map((item, index) => parseRun(item, file, index));
}

function groupRate(runs: RawRun[], policy: "structured" | "vision", category?: string): V4Rate {
  const subset = runs.filter((run) => run.policy === policy && (category === undefined || run.taskCategory === category));
  const passed = subset.filter((run) => run.goal).length;
  return rate(passed, subset.length);
}

function summarizeFile(runs: RawRun[], file: string): V4FileSummary {
  if (runs.length === 0) fail(`${file} has no runs`);
  const first = runs[0];
  if (!first) fail(`${file} has no runs`);
  for (const run of runs) {
    if (run.protocol !== "scir-compare-v0" || run.protocolVersion !== 4) {
      fail(`${file} run ${run.task}#${run.runIndex} is ${run.protocol} v${run.protocolVersion}, expected scir-compare-v0 v4`);
    }
    if (run.model !== first.model || run.adapter !== first.adapter) {
      fail(`${file} mixes model or adapter values`);
    }
    if ((run.goal === true) !== (run.verdict === "DONE")) {
      fail(`${file} ${run.task} ${run.policy}#${run.runIndex} goal/verdict mismatch`);
    }
  }
  const categories: string[] = [];
  const tasks: Array<{ task: string; category: string }> = [];
  for (const run of runs) {
    if (!categories.includes(run.taskCategory)) categories.push(run.taskCategory);
    if (!tasks.some((item) => item.task === run.task)) tasks.push({ task: run.task, category: run.taskCategory });
  }
  const byCategory: V4FileSummary["byCategory"] = {};
  for (const category of categories) {
    byCategory[category] = {
      structured: groupRate(runs, "structured", category),
      vision: groupRate(runs, "vision", category),
    };
  }
  const issueCodes: Record<string, number> = {};
  for (const run of runs) {
    for (const step of run.steps) {
      for (const issue of step.issues) issueCodes[issue.code] = (issueCodes[issue.code] ?? 0) + 1;
    }
  }
  const policyMetrics = (policy: "structured" | "vision"): V4PolicyMetrics => {
    const subset = runs.filter((run) => run.policy === policy);
    const codes: Record<string, number> = {};
    for (const run of subset) {
      for (const step of run.steps) {
        for (const issue of step.issues) codes[issue.code] = (codes[issue.code] ?? 0) + 1;
      }
    }
    return {
      rate: groupRate(runs, policy),
      latencyMs: {
        p50: linearQuantile(subset.map((run) => run.latencyMs), 0.5),
        p95: linearQuantile(subset.map((run) => run.latencyMs), 0.95),
        mean: mean(subset.map((run) => run.latencyMs)),
      },
      observationTokens: {
        mean: mean(subset.map((run) => run.observationTokens)),
        p95: linearQuantile(subset.map((run) => run.observationTokens), 0.95),
      },
      meanSteps: mean(subset.map((run) => run.stepCount)),
      issueCodes: codes,
    };
  };
  return {
    file,
    model: first.model,
    adapter: first.adapter,
    protocol: first.protocol,
    protocolVersion: first.protocolVersion,
    runs: runs.length,
    structured: groupRate(runs, "structured"),
    vision: groupRate(runs, "vision"),
    byPolicy: {
      structured: policyMetrics("structured"),
      vision: policyMetrics("vision"),
    },
    byCategory,
    byTask: tasks.map((item) => ({
      task: item.task,
      category: item.category,
      structured: groupRate(
        runs.filter((run) => run.task === item.task),
        "structured",
      ),
      vision: groupRate(
        runs.filter((run) => run.task === item.task),
        "vision",
      ),
    })),
    latencyMs: {
      p50: linearQuantile(runs.map((run) => run.latencyMs), 0.5),
      p95: linearQuantile(runs.map((run) => run.latencyMs), 0.95),
      mean: mean(runs.map((run) => run.latencyMs)),
    },
    observationTokens: {
      mean: mean(runs.map((run) => run.observationTokens)),
      p95: linearQuantile(runs.map((run) => run.observationTokens), 0.95),
    },
    meanSteps: mean(runs.map((run) => run.stepCount)),
    issueCodes,
    failedRuns: runs.filter((run) => !run.goal).length,
  };
}

function issueCount(run: RawRun): number {
  return run.steps.reduce((sum, step) => sum + step.issues.length, 0);
}

function toTrace(run: RawRun): V4FailureTrace {
  const issueCodes: string[] = [];
  for (const step of run.steps) {
    for (const issue of step.issues) {
      if (!issueCodes.includes(issue.code)) issueCodes.push(issue.code);
    }
  }
  const failedChecks = run.checks
    .filter((check) => !check.ok)
    .map((check) => {
      const failed: { id: string; detail?: string } = { id: check.id };
      if (check.detail !== undefined) failed.detail = check.detail;
      return failed;
    });
  return {
    file: run.file,
    model: run.model,
    adapter: run.adapter,
    task: run.task,
    taskCategory: run.taskCategory,
    policy: run.policy,
    runIndex: run.runIndex,
    verdict: run.verdict,
    goal: run.goal,
    latencyMs: run.latencyMs,
    issueCodes,
    failedChecks,
    steps: run.steps.map((step) => ({
      i: step.i,
      status: step.status,
      action: actionLabel(step.action),
      issues: step.issues.map((issue) => issue.code),
    })),
  };
}

function pickFailure(runs: RawRun[], policy: "structured" | "vision"): RawRun | undefined {
  const failed = runs.filter((run) => run.policy === policy && !run.goal);
  failed.sort((left, right) => issueCount(right) - issueCount(left) || right.steps.length - left.steps.length || left.runIndex - right.runIndex);
  return failed[0];
}

export function summarizeV4Live(root = REPO_ROOT): V4Summary {
  const files: V4FileSummary[] = [];
  const failureTraces: V4FailureTrace[] = [];
  let totalRuns = 0;
  for (const file of V4_RESULT_FILES) {
    const runs = loadRuns(root, file);
    totalRuns += runs.length;
    files.push(summarizeFile(runs, file));
    for (const policy of ["structured", "vision"] as const) {
      const picked = pickFailure(runs, policy);
      if (picked) failureTraces.push(toTrace(picked));
    }
  }
  if (totalRuns !== 360) fail(`expected 360 v4 runs, found ${totalRuns}`);
  return {
    protocol: "scir-compare-v0",
    protocolVersion: 4,
    source: "committed live logs",
    totalRuns,
    files,
    failureTraces,
  };
}

function formatRate(value: V4Rate): string {
  return value.rate;
}

export function formatV4Summary(summary: V4Summary): string {
  const lines = [
    "# v4 live summary",
    "",
    "Computed from the committed `scir-compare-v0` protocol v4 logs. No runs were resimulated.",
    "",
    `- total runs: ${summary.totalRuns}`,
    `- files: ${summary.files.length}`,
    "",
  ];
  for (const file of summary.files) {
    lines.push(`## ${file.file}`, "");
    lines.push(`- model: ${file.model}`);
    lines.push(`- adapter: ${file.adapter}`);
    lines.push(`- runs: ${file.runs}`);
    lines.push(`- structured: ${formatRate(file.structured)}`);
    lines.push(`- vision: ${formatRate(file.vision)}`);
    lines.push(`- failed runs: ${file.failedRuns}`);
    lines.push("");
    lines.push("| Category | Structured | Vision |");
    lines.push("| --- | --- | --- |");
    for (const [category, rates] of Object.entries(file.byCategory)) {
      lines.push(`| ${category} | ${formatRate(rates.structured)} | ${formatRate(rates.vision)} |`);
    }
    lines.push("");
    lines.push("| Task | Category | Structured | Vision |");
    lines.push("| --- | --- | --- | --- |");
    for (const task of file.byTask) {
      lines.push(`| ${task.task} | ${task.category} | ${formatRate(task.structured)} | ${formatRate(task.vision)} |`);
    }
    lines.push("");
    lines.push(
      `- structured latencyMs p50/p95/mean: ${file.byPolicy.structured.latencyMs.p50.toFixed(2)} / ${file.byPolicy.structured.latencyMs.p95.toFixed(2)} / ${file.byPolicy.structured.latencyMs.mean.toFixed(2)}`,
    );
    lines.push(
      `- vision latencyMs p50/p95/mean: ${file.byPolicy.vision.latencyMs.p50.toFixed(2)} / ${file.byPolicy.vision.latencyMs.p95.toFixed(2)} / ${file.byPolicy.vision.latencyMs.mean.toFixed(2)}`,
    );
    lines.push(
      `- structured observationTokens mean/p95: ${file.byPolicy.structured.observationTokens.mean.toFixed(1)} / ${file.byPolicy.structured.observationTokens.p95.toFixed(1)}; mean steps: ${file.byPolicy.structured.meanSteps.toFixed(2)}`,
    );
    lines.push(
      `- vision observationTokens mean/p95: ${file.byPolicy.vision.observationTokens.mean.toFixed(1)} / ${file.byPolicy.vision.observationTokens.p95.toFixed(1)}; mean steps: ${file.byPolicy.vision.meanSteps.toFixed(2)}`,
    );
    lines.push(
      `- combined latencyMs p50/p95/mean: ${file.latencyMs.p50.toFixed(2)} / ${file.latencyMs.p95.toFixed(2)} / ${file.latencyMs.mean.toFixed(2)} (metrics.latencyMs, linear quantile)`,
    );
    lines.push(
      `- combined observationTokens mean/p95: ${file.observationTokens.mean.toFixed(1)} / ${file.observationTokens.p95.toFixed(1)}; mean steps: ${file.meanSteps.toFixed(2)}`,
    );
    lines.push("");
    lines.push("| Issue code | Count |");
    lines.push("| --- | --- |");
    for (const [code, count] of Object.entries(file.issueCodes).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
      lines.push(`| ${code} | ${count} |`);
    }
    lines.push("");
  }
  lines.push("## Representative failure traces", "");
  lines.push("One structured failure and one vision failure from each file, preferring the run with the most recorded issue codes.");
  lines.push("");
  for (const trace of summary.failureTraces) {
    lines.push(
      `### ${trace.adapter} ${trace.model} ${trace.policy} ${trace.task} #${trace.runIndex}`,
      "",
      `- file: ${trace.file}`,
      `- verdict: ${trace.verdict}`,
      `- goal: ${String(trace.goal)}`,
      `- latencyMs: ${trace.latencyMs}`,
      `- issue codes: ${trace.issueCodes.join(", ") || "(none recorded)"}`,
    );
    if (trace.failedChecks.length > 0) {
      lines.push(
        `- failed checks: ${trace.failedChecks
          .map((check) => (check.detail !== undefined ? `${check.id}=${check.detail}` : check.id))
          .join("; ")}`,
      );
    }
    for (const step of trace.steps) {
      const issues = step.issues.length > 0 ? ` [${step.issues.join(", ")}]` : "";
      lines.push(`- step ${step.i}: ${step.status} ${step.action}${issues}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeV4Summary(root = REPO_ROOT, summary = summarizeV4Live(root)): { jsonPath: string; markdownPath: string; summary: V4Summary } {
  const directory = join(root, "eval", "results");
  mkdirSync(directory, { recursive: true });
  const jsonPath = join(directory, "v4-live-summary.json");
  const markdownPath = join(directory, "v4-live-summary.md");
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(markdownPath, formatV4Summary(summary));
  return { jsonPath, markdownPath, summary };
}
