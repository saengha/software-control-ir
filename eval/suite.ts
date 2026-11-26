import { runFreeExecTask } from "./baselines/free-exec.js";
import { buildReport } from "./report.js";
import { runScirTask } from "./runners/scir-runner.js";
import { DETERMINISTIC_TOKEN_NOTE } from "./types.js";
import type { EvalSuiteReport, EvalTask } from "./types.js";

export function runDeterministicSuite(tasks: EvalTask[]): EvalSuiteReport {
  if (tasks.length === 0) throw new Error("deterministic suite has no tasks");
  const results = [];
  for (const task of tasks) {
    results.push(runFreeExecTask(task));
    results.push(runScirTask(task));
  }
  return buildReport("deterministic-harness", results, DETERMINISTIC_TOKEN_NOTE);
}
