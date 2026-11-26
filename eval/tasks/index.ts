import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "../../src/index.js";
import type {
  EvalDifficulty,
  EvalExpect,
  EvalPlanStep,
  EvalPreset,
  EvalTag,
  EvalTask,
  HostInjectSpec,
  PropertyExpect,
} from "../types.js";
import { EVAL_DIFFICULTIES, EVAL_TAGS } from "../types.js";

const TASK_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED_COUNTS: Record<EvalTag, number> = {
  normal: 12,
  edge: 9,
  adversarial: 9,
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

function asJson(value: unknown, path: string): Json {
  if (value === undefined) fail(`${path} is not valid JSON`);
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    fail(`${path} is not valid JSON`);
  }
}

function asJsonRecord(value: unknown, path: string): Record<string, Json> {
  const record = asRecord(value, path);
  const json = asJson(record, path);
  if (!isRecord(json)) fail(`${path} must be a JSON object`);
  return json as Record<string, Json>;
}

function asStringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${path} must be a non-empty string array`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

function parsePreset(value: unknown, path: string): EvalPreset {
  if (value === "board" || value === "contrast") return value;
  fail(`${path} must be "board" or "contrast"`);
}

function parseTag(value: unknown, path: string): EvalTag {
  if (typeof value === "string" && (EVAL_TAGS as readonly string[]).includes(value)) return value as EvalTag;
  fail(`${path} must be a known tag`);
}

function parseDifficulty(value: unknown, path: string): EvalDifficulty {
  if (typeof value === "string" && (EVAL_DIFFICULTIES as readonly string[]).includes(value)) {
    return value as EvalDifficulty;
  }
  fail(`${path} must be a known difficulty`);
}

function parseStep(value: unknown, path: string): EvalPlanStep {
  const record = asRecord(value, path);
  const op = asString(record.op, `${path}.op`);
  if (op === "undo" || op === "sync" || op === "host_inject") return { op };
  if (op === "apply") return { op, action: asJsonRecord(record.action, `${path}.action`) };
  if (op === "transaction") {
    if (!Array.isArray(record.actions) || record.actions.length === 0) {
      fail(`${path}.actions must be a non-empty array`);
    }
    return {
      op,
      actions: record.actions.map((action, index) => asJsonRecord(action, `${path}.actions[${index}]`)),
    };
  }
  fail(`${path}.op "${op}" is not a plan operation`);
}

function parseExpect(value: unknown, path: string): EvalExpect {
  const record = asRecord(value, path);
  const allowed = new Set([
    "properties",
    "activeSlide",
    "present",
    "absent",
    "unchangedIds",
    "documentUnchanged",
    "rolledBack",
    "syncedDrift",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${path}.${key} is not an expectation field`);
  }
  const expect: EvalExpect = {};
  if (record.properties !== undefined) {
    if (!Array.isArray(record.properties)) fail(`${path}.properties must be an array`);
    const properties: PropertyExpect[] = record.properties.map((item, index) => {
      const property = asRecord(item, `${path}.properties[${index}]`);
      return {
        id: asString(property.id, `${path}.properties[${index}].id`),
        path: asString(property.path, `${path}.properties[${index}].path`),
        equals: asJson(property.equals, `${path}.properties[${index}].equals`),
      };
    });
    expect.properties = properties;
  }
  if (record.activeSlide !== undefined) expect.activeSlide = asString(record.activeSlide, `${path}.activeSlide`);
  if (record.present !== undefined) expect.present = asStringList(record.present, `${path}.present`);
  if (record.absent !== undefined) expect.absent = asStringList(record.absent, `${path}.absent`);
  if (record.unchangedIds !== undefined) expect.unchangedIds = asStringList(record.unchangedIds, `${path}.unchangedIds`);
  if (record.documentUnchanged !== undefined) {
    if (typeof record.documentUnchanged !== "boolean") fail(`${path}.documentUnchanged must be boolean`);
    expect.documentUnchanged = record.documentUnchanged;
  }
  if (record.rolledBack !== undefined) {
    if (typeof record.rolledBack !== "boolean") fail(`${path}.rolledBack must be boolean`);
    expect.rolledBack = record.rolledBack;
  }
  if (record.syncedDrift !== undefined) {
    if (typeof record.syncedDrift !== "boolean") fail(`${path}.syncedDrift must be boolean`);
    expect.syncedDrift = record.syncedDrift;
  }
  return expect;
}

function parseHostInject(value: unknown, path: string): HostInjectSpec {
  const record = asRecord(value, path);
  const spec: HostInjectSpec = {
    action: asString(record.action, `${path}.action`),
    params: asJsonRecord(record.params ?? {}, `${path}.params`),
  };
  if (record.target !== undefined) spec.target = asString(record.target, `${path}.target`);
  if (record.trigger !== undefined) {
    const trigger = asRecord(record.trigger, `${path}.trigger`);
    spec.trigger = {
      id: asString(trigger.id, `${path}.trigger.id`),
      property: asString(trigger.property, `${path}.trigger.property`),
      equals: asJson(trigger.equals, `${path}.trigger.equals`),
    };
  }
  return spec;
}

function parseTask(value: unknown, path: string): EvalTask {
  const record = asRecord(value, path);
  const task: EvalTask = {
    id: asString(record.id, `${path}.id`),
    tag: parseTag(record.tag, `${path}.tag`),
    difficulty: parseDifficulty(record.difficulty, `${path}.difficulty`),
    preset: parsePreset(record.preset, `${path}.preset`),
    title: asString(record.title, `${path}.title`),
    goal: asString(record.goal, `${path}.goal`),
    prompt: asString(record.prompt, `${path}.prompt`),
    scirPlan: Array.isArray(record.scirPlan)
      ? record.scirPlan.map((step, index) => parseStep(step, `${path}.scirPlan[${index}]`))
      : fail(`${path}.scirPlan must be an array`),
    baselineCode: asString(record.baselineCode, `${path}.baselineCode`),
    expect: parseExpect(record.expect, `${path}.expect`),
  };
  if (task.scirPlan.length === 0) fail(`${path}.scirPlan must not be empty`);
  if (record.allowedWriteIds !== undefined) {
    task.allowedWriteIds = asStringList(record.allowedWriteIds, `${path}.allowedWriteIds`);
  }
  if (record.forbidLockedMutation !== undefined) {
    if (typeof record.forbidLockedMutation !== "boolean") fail(`${path}.forbidLockedMutation must be boolean`);
    task.forbidLockedMutation = record.forbidLockedMutation;
  }
  if (record.hostInject !== undefined) task.hostInject = parseHostInject(record.hostInject, `${path}.hostInject`);
  return task;
}

function readTaskFile(name: string): EvalTask[] {
  const path = join(TASK_DIR, name);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Could not read ${name}: ${message}`);
  }
  if (!Array.isArray(parsed)) fail(`${name} must be a JSON array`);
  return parsed.map((item, index) => parseTask(item, `${name}[${index}]`));
}

export function loadEvalTasks(): EvalTask[] {
  const tasks = [
    ...readTaskFile("normal.json"),
    ...readTaskFile("edge.json"),
    ...readTaskFile("adversarial.json"),
  ];
  if (tasks.length !== 30) fail(`Expected 30 eval tasks, found ${tasks.length}`);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) fail(`Duplicate eval task id "${task.id}"`);
    ids.add(task.id);
  }
  for (const tag of EVAL_TAGS) {
    const count = tasks.filter((task) => task.tag === tag).length;
    if (count !== EXPECTED_COUNTS[tag]) {
      fail(`Expected ${EXPECTED_COUNTS[tag]} ${tag} tasks, found ${count}`);
    }
  }
  return tasks;
}
