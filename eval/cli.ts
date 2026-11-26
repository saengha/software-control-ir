import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEvalTasks } from "./tasks/index.js";
import { evaluateGate, formatReport } from "./report.js";
import { formatV4Summary, writeV4Summary } from "./summarize-v4.js";
import { runDeterministicSuite } from "./suite.js";
import { LiveEndpointError, runLiveSuite, type LiveProvider } from "./runners/live-llm.js";
import { EVAL_TAGS } from "./types.js";
import type { EvalTag, EvalTask } from "./types.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function argument(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((item) => item.startsWith(prefix));
  if (!found) return undefined;
  const value = found.slice(prefix.length);
  if (value.length === 0) throw new Error(`--${name} requires a value`);
  return value;
}

function selectTasks(tasks: EvalTask[], argv: string[]): EvalTask[] {
  const tag = argument(argv, "tag");
  const taskArg = argument(argv, "task");
  let selected = tasks;
  if (tag !== undefined) {
    if (!(EVAL_TAGS as readonly string[]).includes(tag)) {
      throw new Error(`unknown tag "${tag}". Use ${EVAL_TAGS.join(", ")}`);
    }
    selected = selected.filter((task) => task.tag === (tag as EvalTag));
  }
  if (taskArg !== undefined) {
    const ids = taskArg.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    if (ids.length === 0) throw new Error("--task requires at least one id");
    for (const id of ids) {
      if (!tasks.some((task) => task.id === id)) throw new Error(`unknown task "${id}"`);
    }
    selected = selected.filter((task) => ids.includes(task.id));
  }
  if (selected.length === 0) throw new Error("no tasks selected");
  return selected;
}

function writePair(prefix: string, markdown: string, json: unknown): void {
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.md`, markdown);
  writeFileSync(`${prefix}.json`, `${JSON.stringify(json, null, 2)}\n`);
}

function outputPrefix(argv: string[], fallbackName: string): string {
  return argument(argv, "out") ?? join(REPO_ROOT, "eval", "results", fallbackName);
}

function parseProvider(value: string | undefined): LiveProvider {
  if (value === undefined || value === "openai" || value === "openai-compatible") return "openai";
  if (value === "gemini" || value === "anthropic") return value;
  throw new Error(`unknown provider "${value}". Use openai, gemini, or anthropic`);
}

function parseCost(argv: string[], name: string): number | undefined {
  const value = argument(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative finite number`);
  return parsed;
}

export async function main(argv: string[]): Promise<number> {
  const mode = argument(argv, "mode");
  if (mode === "v4-summary") {
    const written = writeV4Summary();
    console.log(formatV4Summary(written.summary));
    console.log(`wrote ${written.jsonPath}`);
    console.log(`wrote ${written.markdownPath}`);
    return 0;
  }
  if (mode === "deterministic" || mode === "gate") {
    const tasks = mode === "gate" ? loadEvalTasks() : selectTasks(loadEvalTasks(), argv);
    if (mode === "gate" && (argument(argv, "tag") !== undefined || argument(argv, "task") !== undefined)) {
      console.log("gate mode runs all 30 tasks");
    }
    const report = runDeterministicSuite(tasks);
    const markdown = formatReport(report);
    console.log(markdown);
    const outArg = argument(argv, "out");
    if (mode === "deterministic" || outArg !== undefined) {
      writePair(outputPrefix(argv, mode === "gate" ? "gate-report" : "deterministic-report"), markdown, report);
    }
    if (mode === "deterministic") return 0;
    const gate = evaluateGate(report);
    if (gate.ok) {
      console.log("GATE PASS: SCIR 30/30, SCIR safety violations 0, free-exec safety violations > 0");
      return 0;
    }
    console.error("GATE FAIL");
    for (const reason of gate.reasons) console.error(`- ${reason}`);
    return 1;
  }
  if (mode === "live") {
    const provider = parseProvider(argument(argv, "provider") ?? process.env.SCIR_COMPARE_PROVIDER);
    const model = argument(argv, "model") ?? process.env.SCIR_COMPARE_MODEL;
    if (!model) throw new LiveEndpointError("missing --model");
    const baseUrl = argument(argv, "base-url") ?? process.env.SCIR_COMPARE_BASE_URL;
    const inputCostPer1M = parseCost(argv, "input-cost-per-1m");
    const outputCostPer1M = parseCost(argv, "output-cost-per-1m");
    const report = await runLiveSuite({
      provider,
      model,
      tasks: selectTasks(loadEvalTasks(), argv),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(inputCostPer1M !== undefined ? { inputCostPer1M } : {}),
      ...(outputCostPer1M !== undefined ? { outputCostPer1M } : {}),
    });
    const markdown = formatReport(report);
    console.log(markdown);
    writePair(outputPrefix(argv, "live-report"), markdown, report);
    return 0;
  }
  throw new Error("missing --mode=deterministic|gate|v4-summary|live");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      if (error instanceof LiveEndpointError) console.error(error.message);
      else if (error instanceof Error) console.error(error.stack ?? error.message);
      else console.error(String(error));
      process.exit(1);
    });
}
