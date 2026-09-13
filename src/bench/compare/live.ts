import { cloneJson } from "../../ir/normalize.js";
import type { CompactResult } from "../../ir/types.js";
import type { Adapter } from "../../runtime/adapter.js";
import { Session } from "../../runtime/session.js";
import { createDispatcher, toolDescriptors } from "../../transport/tools.js";
import {
  comparePrompt,
  finishCompareLog,
  injectHostIfDue,
  isPlain,
  performCompareStep,
  summarizeObservation,
  type CompareRunLog,
  type CompareRunOptions,
  type CompareStepLog,
} from "./run.js";
import { observeVision } from "./observe.js";
import type { ComparePolicy } from "./protocol.js";
import type { CompareTask } from "./tasks.js";
import type { ModelClient, ModelContent, ModelMessage, ModelToolCall } from "./model.js";
import { parseStopVerdict, toolsForPolicy } from "./model.js";
import { visionToolFeedback, type UiChrome } from "./ui.js";
import { captureVisionFrame, imageToWorld, type VisionFrame } from "./vision-frame.js";

function asCompact(session: Session, value: unknown): CompactResult & { rolledBack?: boolean } {
  if (
    isPlain(value) &&
    (value.status === "accepted" || value.status === "rejected" || value.status === "failed") &&
    typeof value.revision === "number" &&
    Array.isArray(value.effects)
  ) {
    return value as unknown as CompactResult & { rolledBack?: boolean };
  }
  return { status: "accepted", revision: session.snapshot().revision, effects: [] };
}

function resolveStructuredName(adapterId: string, name: string): string {
  if (name.startsWith("scir.") || name.startsWith(`${adapterId}.`)) return name;
  if (name === "undo" || name === "sync" || name === "rollback" || name === "state" || name === "describe" || name === "transaction") {
    return `scir.${name}`;
  }
  return `${adapterId}.${name}`;
}

function visionProposed(call: ModelToolCall, frame: VisionFrame | undefined): unknown {
  if (call.name === "screenshot") return { tool: "screenshot" };
  if (call.name === "type") return { tool: "type", text: String(call.input.text ?? "") };
  if (call.name === "scroll") {
    const direction = call.input.direction;
    return {
      tool: "scroll",
      direction: direction === "up" || direction === "left" || direction === "right" ? direction : "down",
    };
  }
  const x = typeof call.input.x === "number" ? call.input.x : 0;
  const y = typeof call.input.y === "number" ? call.input.y : 0;
  const mapped = frame ? imageToWorld(frame, x, y) : { x, y };
  const extra = { ...call.input };
  delete extra.x;
  delete extra.y;
  return { tool: call.name, x: mapped.x, y: mapped.y, ...extra };
}

function structuredProposed(adapterId: string, call: ModelToolCall): unknown {
  const name = resolveStructuredName(adapterId, call.name);
  if (name === "scir.undo") return { action: "undo" };
  if (name === "scir.sync") return { action: "sync" };
  if (name === "scir.rollback") return { action: "rollback", revision: call.input.revision };
  const { target, expectedRevision, ...params } = call.input;
  const proposed: Record<string, unknown> = {
    action: name.startsWith(`${adapterId}.`) ? name.slice(adapterId.length + 1) : name.replace(/^scir\./, ""),
    params,
  };
  if (typeof target === "string") proposed.target = target;
  if (typeof expectedRevision === "number") proposed.expectedRevision = expectedRevision;
  for (const [key, value] of Object.entries(params)) proposed[key] = value;
  return proposed;
}

export async function runCompareLive(
  adapter: Adapter,
  task: CompareTask,
  policy: ComparePolicy,
  client: ModelClient,
  options?: CompareRunOptions,
): Promise<CompareRunLog> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const session = new Session(adapter);
  const prompt = comparePrompt(session, task, policy);
  let injected = injectHostIfDue(adapter, session, task, 0, false);
  const opening = session.snapshot();
  const openingVision = policy === "vision" ? observeVision(opening) : undefined;
  const observation = summarizeObservation(policy, session, openingVision, opening);
  const steps: CompareStepLog[] = [];
  let chrome: UiChrome = {};
  let frame: VisionFrame | undefined;
  const dispatcher = createDispatcher(session);
  const tools = toolsForPolicy(policy, toolDescriptors(session));
  const messages: ModelMessage[] = [
    {
      role: "user",
      content:
        policy === "structured"
          ? `Goal: ${task.goalText}\nCurrent state: ${JSON.stringify(session.relevant())}`
          : `Goal: ${task.goalText}`,
    },
  ];

  while (steps.length < task.maxSteps) {
    const reply = await client.complete({ system: prompt, tools, messages });
    if (reply.toolCalls.length === 0) {
      break;
    }

    const assistantContent = [
      ...(reply.text ? [{ type: "text" as const, text: reply.text }] : []),
      ...reply.toolCalls.map((call) => ({
        type: "tool_use" as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ];
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults: ModelContent[] = [];
    for (const call of reply.toolCalls) {
      if (steps.length >= task.maxSteps) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ error: "step budget exhausted" }),
        });
        continue;
      }
      const stepStarted = performance.now();
      let result: CompactResult & { rolledBack?: boolean };
      let bound: unknown;
      let size = { chars: 0, approxTokens: 0 };
      let proposed: unknown;

      if (policy === "vision") {
        proposed = visionProposed(call, frame);
        const done = performCompareStep(session, "vision", proposed, chrome);
        chrome = done.chrome;
        result = done.result;
        bound = done.bound;
        size = done.size;
        if (call.name === "screenshot") {
          frame = captureVisionFrame(adapter, session.snapshot(), chrome);
        }
      } else {
        const name = resolveStructuredName(adapter.id, call.name);
        proposed = { name, ...call.input };
        if (name === "scir.state" || name === "scir.describe" || name === "scir.transaction") {
          bound = dispatcher(name, call.input);
          result = asCompact(session, bound);
          const text = JSON.stringify(bound);
          size = { chars: text.length, approxTokens: Math.ceil(text.length / 4) };
        } else {
          proposed = structuredProposed(adapter.id, call);
          const done = performCompareStep(session, "structured", proposed, chrome);
          result = done.result;
          bound = done.bound;
          size = done.size;
        }
      }

      steps.push({
        i: steps.length,
        proposed: cloneJson(proposed),
        action: cloneJson(bound),
        result,
        latencyMs: Math.round((performance.now() - stepStarted) * 100) / 100,
        observationChars: size.chars,
        observationTokens: size.approxTokens,
      });
      injected = injectHostIfDue(adapter, session, task, steps.length, injected);

      if (policy === "vision" && call.name === "screenshot" && frame) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: frame.png.toString("base64") },
            },
            {
              type: "text",
              text: JSON.stringify({
                width: frame.width,
                height: frame.height,
                chrome: visionToolFeedback(session.snapshot(), chrome),
              }),
            },
          ],
        });
      } else if (policy === "vision") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(visionToolFeedback(session.snapshot(), chrome)),
        });
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ result, state: session.relevant() }),
        });
      }
    }
    messages.push({ role: "user", content: toolResults });

    if (parseStopVerdict(reply.text) && reply.toolCalls.length === 0) break;
  }

  const runOptions: CompareRunOptions = {
    driver: "live",
    runIndex: options?.runIndex ?? 0,
    model: client.model,
  };
  return finishCompareLog({
    adapter,
    task,
    policy,
    session,
    prompt,
    steps,
    observation,
    startedAt,
    started,
    options: runOptions,
  });
}
