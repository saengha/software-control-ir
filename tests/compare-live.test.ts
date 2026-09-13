import { describe, expect, it } from "vitest";
import {
  COMPARE_LIVE_MODEL,
  HOST_DRIFT_AFTER_STEPS,
  Session,
  SlidesAdapter,
  createReplayClient,
  formatCompareTable,
  observeVision,
  parseCompareArgs,
  repeatStats,
  runCompareLive,
  runSlidesCompare,
  sampleStdev,
  visionToolFeedback,
  withBackoff,
} from "../src/index.js";
import { COMPARE_TASKS } from "../src/bench/compare/tasks.js";
import { decodePngRgb, encodePngRgb } from "../src/adapters/impress/png.js";
import { RetryableModelError, type ModelClient, type ModelRequest } from "../src/bench/compare/model.js";
import { executeUiAction } from "../src/bench/compare/ui.js";

describe("compare repeats and aggregation", () => {
  it("records runIndex 0..n-1 and keeps fixture isolation", () => {
    const logs = runSlidesCompare({ category: "execution", repeats: 2 });
    expect(logs).toHaveLength(12);
    expect(new Set(logs.map((log) => log.runIndex))).toEqual(new Set([0, 1]));
    const first = logs.find((log) => log.task === "rename_title" && log.policy === "structured" && log.runIndex === 0);
    const second = logs.find((log) => log.task === "rename_title" && log.policy === "structured" && log.runIndex === 1);
    expect(first?.metrics.verdict).toBe("DONE");
    expect(second?.metrics.verdict).toBe("DONE");
  });

  it("prints n/N rates and sample standard deviation", () => {
    const mixed = runSlidesCompare({ category: "execution" }).map((log, index) =>
      log.policy === "vision" && index % 2 === 0
        ? { ...log, metrics: { ...log.metrics, verdict: "FAILED" as const } }
        : log,
    );
    const stats = repeatStats(mixed, "rename_title", "structured");
    expect(stats.rate).toMatch(/^\d+\/\d+$/);
    expect(sampleStdev([1, 0, 1, 0, 1])).toBeGreaterThan(0.4);
    const table = formatCompareTable(runSlidesCompare({ repeats: 2 }));
    expect(table).toContain("2/2");
    expect(table).toContain("s_σ");
  });

  it("defaults live compare to one shared model and dry-run to a single repeat", () => {
    expect(parseCompareArgs(["--dry-run"]).repeats).toBe(1);
    expect(parseCompareArgs(["--dry-run"]).driver).toBe("live");
    expect(parseCompareArgs(["--scripted", "--repeats=5"]).repeats).toBe(5);
    expect(parseCompareArgs(["--scripted"]).driver).toBe("scripted");
    expect(parseCompareArgs(["--task=contrast_check,host_drift"]).tasks).toEqual([
      "contrast_check",
      "host_drift",
    ]);
    expect(COMPARE_LIVE_MODEL.length).toBeGreaterThan(0);
  });

  it("can run a two-task pilot subset", () => {
    const logs = runSlidesCompare({ tasks: ["contrast_check", "host_drift"], repeats: 1 });
    expect(new Set(logs.map((log) => log.task))).toEqual(new Set(["contrast_check", "host_drift"]));
    expect(logs).toHaveLength(4);
  });
});

describe("live loop (replay client)", () => {
  it("replays all nine tasks through the live loop once", async () => {
    for (const task of COMPARE_TASKS) {
      for (const policy of ["structured", "vision"] as const) {
        const adapter = new SlidesAdapter({ preset: task.fixture === "contrast" ? "contrast" : "default" });
        const client = createReplayClient(task.script(policy, { adapterId: "slides" }), COMPARE_LIVE_MODEL, "slides");
        const log = await runCompareLive(adapter, task, policy, client, { runIndex: 0 });
        expect(log.driver).toBe("live");
        expect(log.model).toBe(COMPARE_LIVE_MODEL);
        expect(log.runIndex).toBe(0);
      }
    }
  });
  it("runs structured and vision through the same model id", async () => {
    const task = COMPARE_TASKS.find((entry) => entry.id === "rename_title")!;
    const adapter = new SlidesAdapter();
    const structuredClient = createReplayClient(task.script("structured", { adapterId: "slides" }), COMPARE_LIVE_MODEL, "slides");
    const visionClient = createReplayClient(task.script("vision", { adapterId: "slides" }), COMPARE_LIVE_MODEL, "slides");
    expect(structuredClient.model).toBe(visionClient.model);
    const structured = await runCompareLive(adapter, task, "structured", structuredClient, { runIndex: 2 });
    const visionAdapter = new SlidesAdapter();
    const vision = await runCompareLive(visionAdapter, task, "vision", visionClient, { runIndex: 2 });
    expect(structured.driver).toBe("live");
    expect(vision.driver).toBe("live");
    expect(structured.model).toBe(COMPARE_LIVE_MODEL);
    expect(vision.model).toBe(structured.model);
    expect(structured.runIndex).toBe(2);
    expect(structured.metrics.verdict).toBe("DONE");
    expect(vision.metrics.verdict).toBe("DONE");
  });

  it("retries retryable API errors then succeeds", async () => {
    let attempts = 0;
    const value = await withBackoff(async () => {
      attempts += 1;
      if (attempts < 3) throw new RetryableModelError(429, "rate limited");
      return "ok";
    }, 5);
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("keeps host_drift timing out of the goal text", () => {
    const task = COMPARE_TASKS.find((entry) => entry.id === "host_drift")!;
    expect(task.goalText).toBe('Set the title to "Recovered".');
    expect(task.injectAfterSteps).toBe(HOST_DRIFT_AFTER_STEPS);
    expect(task.inject).toEqual({ action: "set_text", target: "title_01", params: { value: "Out of band" } });
  });

  it("does not put IR lock fields or object ids in vision tool results", async () => {
    const session = new Session(new SlidesAdapter());
    const oval = observeVision(session.snapshot()).regions.find((region) => region.appearance === "oval");
    expect(oval).toBeTruthy();
    const x = oval!.x + oval!.width / 2;
    const y = oval!.y + oval!.height / 2;
    const click = executeUiAction(session, {}, { tool: "click", x, y });
    const panel = executeUiAction(session, click.chrome, { tool: "right_click", x, y });
    const typed = executeUiAction(session, panel.chrome, { tool: "type", text: "#2f6f5f" });
    expect(panel.chrome.panel?.locked).toBe(true);
    expect(typed.result.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(JSON.stringify(click.result)).toContain("logo_01");
    for (const chrome of [click.chrome, panel.chrome, typed.chrome]) {
      const payload = JSON.stringify(visionToolFeedback(session.snapshot(), chrome));
      expect(payload).not.toContain('"locked":');
      expect(payload).not.toContain("logo_01");
      expect(payload).not.toContain('"effects"');
      expect(payload).not.toContain('"issues"');
    }

    const task = COMPARE_TASKS.find((entry) => entry.id === "recolor_locked_logo")!;
    const adapter = new SlidesAdapter();
    const inner = createReplayClient(task.script("vision", { adapterId: "slides" }), COMPARE_LIVE_MODEL, "slides");
    const requests: ModelRequest[] = [];
    const client: ModelClient = {
      model: inner.model,
      complete(request) {
        requests.push(request);
        return inner.complete(request);
      },
    };
    await runCompareLive(adapter, task, "vision", client, { runIndex: 0 });
    const blobs = requests.flatMap((request) => visionToolResultTexts(request));
    expect(blobs.length).toBeGreaterThan(0);
    for (const blob of blobs) {
      expect(blob).not.toContain('"locked":');
      expect(blob).not.toContain("logo_01");
      expect(blob).not.toContain("title_01");
      expect(blob).not.toContain('"effects"');
      expect(blob).not.toContain('"issues"');
    }
  });
});

function visionToolResultTexts(request: ModelRequest): string[] {
  const texts: string[] = [];
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!("type" in part) || part.type !== "tool_result") continue;
      if (typeof part.content === "string") {
        texts.push(part.content);
        continue;
      }
      for (const item of part.content) {
        if (item.type === "text") texts.push(item.text);
      }
    }
  }
  return texts;
}

describe("png screenshot codec", () => {
  it("round-trips RGB bytes", () => {
    const raster = {
      width: 2,
      height: 2,
      pixels: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    };
    const decoded = decodePngRgb(encodePngRgb(raster));
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Buffer.from(decoded.pixels)).toEqual(raster.pixels);
  });
});
