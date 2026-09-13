import { describe, expect, it } from "vitest";
import {
  COMPARE_LIVE_MODEL,
  HOST_INJECT_CONTINUE,
  Session,
  SlidesAdapter,
  compactResult,
  createReplayClient,
  formatCompareTable,
  fromGeminiToolName,
  geminiContentsIncludeHostDiverged,
  geminiToolName,
  normalizeAction,
  observeVision,
  parseCompareArgs,
  repeatStats,
  runCompareLive,
  runSlidesCompare,
  sampleStdev,
  toGeminiContents,
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

describe("gemini live mapping", () => {
  it("rewrites dotted catalog names into Gemini function names", () => {
    expect(geminiToolName("slides.set_text")).toBe("slides__set_text");
    expect(fromGeminiToolName("slides__set_text")).toBe("slides.set_text");
    expect(fromGeminiToolName("screenshot")).toBe("screenshot");
  });

  it("sends screenshots as inline image parts, not IR ids", () => {
    const contents = toGeminiContents([
      { role: "user", content: 'Goal: Set the title to "Recovered".' },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "screenshot", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: "aaaa" } },
              { type: "text", text: JSON.stringify({ width: 640, height: 400, chrome: { toolbar: [] } }) },
            ],
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "slides.set_text",
            input: { target: "title_01", value: "Recovered" },
          },
        ],
      },
    ]);
    expect(contents[1]?.role).toBe("model");
    expect(contents[1]?.parts[0]?.functionCall?.name).toBe("screenshot");
    expect(contents[2]?.parts.some((part) => part.inlineData?.mimeType === "image/png")).toBe(true);
    expect(contents[2]?.parts.some((part) => part.functionResponse?.name === "screenshot")).toBe(true);
    expect(JSON.stringify(contents[2])).not.toContain("logo_01");
    expect(contents[3]?.parts[0]?.functionCall?.name).toBe("slides__set_text");
  });

  it("puts a real host_diverged compact result into Gemini functionResponse", () => {
    const adapter = new SlidesAdapter();
    const session = new Session(adapter);
    session.apply({ action: "set_text", target: "title_01", params: { value: "Recovered" } });
    adapter.execute(
      normalizeAction({ action: "set_text", target: "title_01", params: { value: "Out of band" } }),
      session.snapshot(),
    );
    const result = compactResult(
      session.apply({ action: "set_text", target: "title_01", params: { value: "Recovered" } }),
    );
    expect(result.issues?.some((issue) => issue.code === "host_diverged")).toBe(true);
    const messages: ModelRequest["messages"] = [
      { role: "user", content: 'Goal: Set the title to "Recovered".' },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "retry",
            name: "slides.set_text",
            input: { target: "title_01", value: "Recovered" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "retry",
            content: JSON.stringify({ result, state: session.relevant() }),
          },
        ],
      },
    ];
    expect(geminiContentsIncludeHostDiverged(messages)).toBe(true);
    const payload = JSON.stringify(toGeminiContents(messages));
    expect(payload).toContain("host_diverged");
    expect(payload).toContain("Call sync before applying more actions");
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
    expect(task.goalText).toBe('Change the title to "Recovered" and set its fill to #2f6f5f.');
    expect(task.goalText).not.toMatch(/outside|drift|\bsync\b/i);
    expect(task.injectAfterSteps).toBeUndefined();
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

  it("does not let a one-step structured edit pass host_drift", async () => {
    const task = COMPARE_TASKS.find((entry) => entry.id === "host_drift")!;
    const adapter = new SlidesAdapter();
    let calls = 0;
    const requests: ModelRequest[] = [];
    const client: ModelClient = {
      model: "test-early-stop",
      async complete(request) {
        requests.push(request);
        calls += 1;
        if (calls === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "edit",
                name: "slides.set_text",
                input: { target: "title_01", value: "Recovered" },
              },
            ],
            stop: "tool",
          };
        }
        return { text: "DONE", toolCalls: [], stop: "end" };
      },
    };
    const log = await runCompareLive(adapter, task, "structured", client, { runIndex: 0 });
    expect(log.metrics.verdict).toBe("FAILED");
    expect(log.metrics.usedSync).toBe(false);
    expect(log.checks.find((check) => check.id === "title_recovered")?.detail).toBe("Out of band");
    expect(log.checks.find((check) => check.id === "title_fill")?.ok).toBe(false);
    expect(calls).toBe(2);
    const continues = requests.flatMap((request) =>
      request.messages.filter((message) => message.role === "user").map((message) => message.content),
    ).filter((content) => content === HOST_INJECT_CONTINUE);
    expect(continues).toHaveLength(0);
  });

  it("scores structured host_drift DONE only after diverged, sync, and retry", async () => {
    const task = COMPARE_TASKS.find((entry) => entry.id === "host_drift")!;
    const adapter = new SlidesAdapter();
    const log = await runCompareLive(adapter, task, "structured", hostDriftRecoverClient(), { runIndex: 0 });
    expect(log.metrics.hostDiverged).toBeGreaterThan(0);
    expect(log.metrics.usedSync).toBe(true);
    expect(log.metrics.verdict).toBe("DONE");
    expect(log.checks.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(log.steps.map((step) => step.proposed))).not.toContain(HOST_INJECT_CONTINUE);
  });

  it("injects between batched title text and fill so the second apply diverges", async () => {
    const task = COMPARE_TASKS.find((entry) => entry.id === "host_drift")!;
    const adapter = new SlidesAdapter();
    let n = 0;
    let sentSync = false;
    let recover = 0;
    const client: ModelClient = {
      model: "test-batch-inject",
      async complete(request) {
        n += 1;
        const last = JSON.stringify(request.messages.at(-1) ?? {});
        if (last.includes("host_diverged")) {
          sentSync = true;
          return {
            text: "",
            toolCalls: [{ id: `sync_${n}`, name: "scir.sync", input: {} }],
            stop: "tool" as const,
          };
        }
        if (sentSync && recover === 0) {
          recover = 1;
          return {
            text: "",
            toolCalls: [
              {
                id: `text_${n}`,
                name: "slides.set_text",
                input: { target: "title_01", value: "Recovered" },
              },
            ],
            stop: "tool" as const,
          };
        }
        if (sentSync && recover === 1) {
          recover = 2;
          return {
            text: "",
            toolCalls: [
              {
                id: `fill_${n}`,
                name: "slides.set_fill",
                input: { target: "title_01", value: "#2f6f5f" },
              },
            ],
            stop: "tool" as const,
          };
        }
        if (sentSync) return { text: "DONE", toolCalls: [], stop: "end" as const };
        return {
          text: "",
          toolCalls: [
            {
              id: "text",
              name: "slides.set_text",
              input: { target: "title_01", value: "Recovered" },
            },
            {
              id: "fill",
              name: "slides.set_fill",
              input: { target: "title_01", value: "#2f6f5f" },
            },
          ],
          stop: "tool" as const,
        };
      },
    };
    const log = await runCompareLive(adapter, task, "structured", client, { runIndex: 0 });
    expect(log.steps[0]?.result.status).toBe("accepted");
    expect(log.steps[1]?.result.issues?.some((issue) => issue.code === "host_diverged")).toBe(true);
    expect(log.metrics.hostDiverged).toBeGreaterThan(0);
    expect(log.metrics.usedSync).toBe(true);
    expect(log.metrics.verdict).toBe("DONE");
  });

  it("does not add a sync tool to vision host_drift", async () => {
    const task = COMPARE_TASKS.find((entry) => entry.id === "host_drift")!;
    const adapter = new SlidesAdapter();
    let calls = 0;
    let toolNames: string[] = [];
    const client: ModelClient = {
      model: "test-vision-no-sync",
      async complete(request) {
        toolNames = request.tools.map((tool) => tool.name);
        calls += 1;
        if (calls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "shot", name: "screenshot", input: {} }],
            stop: "tool" as const,
          };
        }
        return { text: "DONE", toolCalls: [], stop: "end" as const };
      },
    };
    const log = await runCompareLive(adapter, task, "vision", client, { runIndex: 0 });
    expect(toolNames).not.toContain("sync");
    expect(toolNames).not.toContain("scir.sync");
    expect(log.metrics.usedSync).toBe(false);
    expect(log.metrics.verdict).toBe("FAILED");
  });
});

function hostDriftRecoverClient(): ModelClient {
  let n = 0;
  let sentSync = false;
  let recover = 0;
  let startedFill = false;
  return {
    model: "test-recover",
    async complete(request) {
      n += 1;
      const last = JSON.stringify(request.messages.at(-1) ?? {});
      if (last.includes("host_diverged")) {
        sentSync = true;
        return {
          text: "",
          toolCalls: [{ id: `sync_${n}`, name: "scir.sync", input: {} }],
          stop: "tool" as const,
        };
      }
      if (sentSync && recover === 0) {
        recover = 1;
        return {
          text: "",
          toolCalls: [
            {
              id: `text_${n}`,
              name: "slides.set_text",
              input: { target: "title_01", value: "Recovered" },
            },
          ],
          stop: "tool" as const,
        };
      }
      if (sentSync && recover === 1) {
        recover = 2;
        return {
          text: "",
          toolCalls: [
            {
              id: `fill_${n}`,
              name: "slides.set_fill",
              input: { target: "title_01", value: "#2f6f5f" },
            },
          ],
          stop: "tool" as const,
        };
      }
      if (sentSync) return { text: "DONE", toolCalls: [], stop: "end" as const };
      if (!startedFill) {
        startedFill = true;
        return {
          text: "",
          toolCalls: [
            {
              id: `edit_${n}`,
              name: "slides.set_text",
              input: { target: "title_01", value: "Recovered" },
            },
          ],
          stop: "tool" as const,
        };
      }
      return {
        text: "",
        toolCalls: [
          {
            id: `fill_pre_${n}`,
            name: "slides.set_fill",
            input: { target: "title_01", value: "#2f6f5f" },
          },
        ],
        stop: "tool" as const,
      };
    },
  };
}

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
