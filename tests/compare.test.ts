import { existsSync, readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import { afterAll, describe, expect, it } from "vitest";
import {
  COMPARE_OVERALL_WARNING,
  COMPARE_PROTOCOL,
  COMPARE_TASK_IDS,
  COMPARE_TASKS,
  ImpressAdapter,
  LOCKED_TARGET_POLICY,
  Session,
  SlidesAdapter,
  TASK_CATEGORIES,
  TASK_CATEGORY,
  VISION_PROMPT,
  bindPolicyAction,
  copyImpressDocument,
  defaultImpressDocument,
  formatCompareTable,
  migrateExperimentLog,
  observeVision,
  runCompare,
  runSlidesCompare,
  visionJsonContainsSecrets,
  type CompareRunLog,
} from "../src/index.js";

const schema = JSON.parse(readFileSync(new URL("../schema/experiment.v2.json", import.meta.url), "utf8"));
const schemaV0 = JSON.parse(readFileSync(new URL("../schema/experiment.v0.json", import.meta.url), "utf8"));

function byTask(logs: CompareRunLog[], task: string, policy: "structured" | "vision") {
  const log = logs.find((entry) => entry.task === task && entry.policy === policy);
  if (!log) throw new Error(`missing ${policy} ${task}`);
  return log;
}

describe("compare protocol", () => {
  const logs = runSlidesCompare();
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema);
  const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/run` });

  it("fixes nine tasks, two prompts, and the same N", () => {
    expect(COMPARE_TASK_IDS).toHaveLength(9);
    expect(logs).toHaveLength(18);
    expect(logs.every((log) => log.protocol === COMPARE_PROTOCOL.id && log.protocolVersion === 4)).toBe(true);
    expect(logs.every((log) => log.driver === "scripted" && log.runIndex === 0)).toBe(true);
    for (const task of COMPARE_TASK_IDS) {
      const structured = byTask(logs, task, "structured");
      const vision = byTask(logs, task, "vision");
      expect(structured.goalText).toBe(vision.goalText);
      expect(structured.maxSteps).toBe(vision.maxSteps);
      expect(structured.taskCategory).toBe(TASK_CATEGORY[task]);
      expect(vision.taskCategory).toBe(TASK_CATEGORY[task]);
    }
  });

  it("tags execution, gated, and vision-favorable without mixing recover_title into execution", () => {
    expect(TASK_CATEGORY.rename_title).toBe("execution");
    expect(TASK_CATEGORY.abort_rebrand).toBe("gated");
    expect(TASK_CATEGORY.recover_title).toBe("gated");
    expect(TASK_CATEGORY.contrast_check).toBe("vision-favorable");
    expect(TASK_CATEGORIES).toEqual(["execution", "gated", "vision-favorable"]);
  });

  it("fills the frozen structured and vision prompts", () => {
    const structured = byTask(logs, "rename_title", "structured");
    const vision = byTask(logs, "rename_title", "vision");
    expect(structured.prompt).toContain("structured tool API");
    expect(structured.prompt).toContain("validation error");
    expect(structured.prompt).toContain(structured.goalText);
    expect(structured.prompt).toContain("You have 8 steps");
    expect(structured.prompt).toContain("set_text");
    expect(structured.prompt).toContain("undo");
    expect(structured.prompt).toContain("sync");
    expect(vision.prompt).toBe(
      VISION_PROMPT.replace("{goal}", vision.goalText).replace("{N}", String(vision.maxSteps)),
    );
    expect(vision.prompt).toContain("click(x, y)");
    expect(vision.prompt).toContain("no access to object IDs");
  });

  it("emits logs that match experiment.v2", () => {
    for (const log of logs) {
      expect(validate(log), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("backfills taskCategory when migrating a v0-shaped log", () => {
    const current = byTask(logs, "abort_rebrand", "structured");
    const rest = { ...current };
    delete (rest as { taskCategory?: string }).taskCategory;
    const migrated = migrateExperimentLog(rest);
    expect(migrated.taskCategory).toBe("gated");
    expect(validate(migrated), JSON.stringify(validate.errors)).toBe(true);
    expect(schemaV0.deprecated).toBe(true);
  });

  it("prints category subtables, an overall table, and the gated-sample warning", () => {
    const table = formatCompareTable(logs);
    expect(table).toContain("--- execution ---");
    expect(table).toContain("--- gated ---");
    expect(table).toContain("--- vision-favorable ---");
    expect(table).toContain("--- overall ---");
    expect(table).toContain(COMPARE_OVERALL_WARNING);
    expect(formatCompareTable(logs, { category: "gated" })).toContain("--- gated ---");
    expect(formatCompareTable(logs, { category: "gated" })).not.toContain("--- execution ---");
  });

  it("keeps object ids and locked out of the vision screenshot", () => {
    const session = new Session(new SlidesAdapter());
    const vision = observeVision(session.snapshot());
    expect(visionJsonContainsSecrets(vision)).toEqual([]);
    expect(vision.regions.some((region) => region.text.includes("Quarterly Review"))).toBe(true);
  });

  it("refuses a vision script that names an object id", () => {
    const session = new Session(new SlidesAdapter());
    const visionObs = observeVision(session.snapshot());
    expect(() =>
      bindPolicyAction("vision", { action: "set_text", target: "title_01", value: "Nope" }, session.snapshot(), visionObs),
    ).toThrow(/object ids/);
  });

  it("lets both policies rename the visible title with different tools", () => {
    const structured = byTask(logs, "rename_title", "structured");
    const vision = byTask(logs, "rename_title", "vision");
    expect(structured.metrics.verdict).toBe("DONE");
    expect(vision.metrics.verdict).toBe("DONE");
    expect(vision.steps.map((step) => (step.proposed as { tool?: string }).tool)).toEqual([
      "screenshot",
      "click",
      "type",
    ]);
    expect(vision.steps.every((step) => !isPlainTarget(step.proposed))).toBe(true);
  });

  it("grades the locked logo against LOCKED_TARGET_POLICY", () => {
    const structured = byTask(logs, "recolor_locked_logo", "structured");
    const vision = byTask(logs, "recolor_locked_logo", "vision");
    expect(vision.metrics.verdict).toBe("FAILED");
    expect(vision.metrics.rejected).toBeGreaterThan(0);
    expect(structured.checks[0]?.detail).toContain(`policy=${LOCKED_TARGET_POLICY}`);
    expect(structured.metrics.verdict).toBe(LOCKED_TARGET_POLICY === "unlock_and_apply" ? "DONE" : "FAILED");
  });

  it("lets vision open the second slide with scroll, without slide ids", () => {
    expect(byTask(logs, "edit_hidden_slide", "structured").metrics.verdict).toBe("DONE");
    expect(byTask(logs, "edit_hidden_slide", "vision").metrics.verdict).toBe("DONE");
    expect(byTask(logs, "edit_hidden_slide", "vision").steps.some((step) => (step.proposed as { tool?: string }).tool === "scroll")).toBe(
      true,
    );
  });

  it("records undo on structured recover and FAILED on vision", () => {
    const structured = byTask(logs, "recover_title", "structured");
    const vision = byTask(logs, "recover_title", "vision");
    expect(structured.metrics.verdict).toBe("DONE");
    expect(structured.metrics.usedRecovery).toBe(true);
    expect(vision.metrics.verdict).toBe("FAILED");
    expect(vision.metrics.usedRecovery).toBe(false);
  });

  it("lets structured skip a rebrand that would fail, and leaves vision dirty", () => {
    expect(byTask(logs, "abort_rebrand", "structured").metrics.verdict).toBe("DONE");
    expect(byTask(logs, "abort_rebrand", "vision").metrics.verdict).toBe("FAILED");
  });

  it("requires sync after delayed host drift in the structured prompt only", () => {
    const structured = byTask(logs, "host_drift", "structured");
    const vision = byTask(logs, "host_drift", "vision");
    expect(structured.goalText).toBe('Change the title to "Recovered" and set its fill to #2f6f5f.');
    expect(structured.goalText).not.toMatch(/outside|drift|\bsync\b/i);
    expect(structured.hostDriftAfterSteps).toBeUndefined();
    expect(structured.metrics.verdict).toBe("DONE");
    expect(structured.metrics.usedSync).toBe(true);
    expect(structured.metrics.hostDiverged).toBeGreaterThan(0);
    expect(structured.checks.every((check) => check.ok)).toBe(true);
    expect(vision.metrics.verdict).toBe("FAILED");
    expect(vision.metrics.hostDiverged).toBeGreaterThan(0);
    expect(vision.metrics.usedSync).toBe(false);
  });
});

function isPlainTarget(value: unknown): boolean {
  return typeof value === "object" && value !== null && "target" in value;
}

const impressReady = ImpressAdapter.available() && existsSync(defaultImpressDocument());

describe.skipIf(!impressReady)("compare protocol on LibreOffice Impress", () => {
  let logs: CompareRunLog[] = [];
  let adapter: ImpressAdapter | undefined;

  afterAll(() => {
    adapter?.close();
  }, 30_000);

  it("runs the same prompts against a live .odp", () => {
    const live = new ImpressAdapter({ document: copyImpressDocument() });
    adapter = live;
    const sample = ["rename_title", "recolor_locked_logo", "host_drift"] as const;
    logs = [];
    for (const id of sample) {
      const task = COMPARE_TASKS.find((entry) => entry.id === id);
      if (!task) throw new Error(id);
      logs.push(runCompare(live, task, "structured"));
      live.reset();
      logs.push(runCompare(live, task, "vision"));
      live.reset();
    }
    expect(byTask(logs, "rename_title", "structured").metrics.verdict).toBe("DONE");
    expect(byTask(logs, "rename_title", "vision").metrics.verdict).toBe("DONE");
    expect(byTask(logs, "host_drift", "structured").metrics.verdict).toBe("DONE");
    expect(byTask(logs, "host_drift", "vision").metrics.hostDiverged).toBeGreaterThan(0);
    expect(byTask(logs, "recolor_locked_logo", "vision").metrics.verdict).toBe("FAILED");
    expect(byTask(logs, "recolor_locked_logo", "structured").metrics.verdict).toBe(
      LOCKED_TARGET_POLICY === "unlock_and_apply" ? "DONE" : "FAILED",
    );
  }, 120_000);
});
