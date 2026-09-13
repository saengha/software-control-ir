import { cloneJson } from "../../ir/normalize.js";
import type { CompactResult } from "../../ir/types.js";
import { SlidesAdapter } from "../../adapters/slides.js";
import { Session } from "../../runtime/session.js";
import { createDispatcher, toolDescriptors } from "../../transport/tools.js";
import {
  comparePrompt,
  injectHostIfDue,
  isPlain,
  performCompareStep,
  taskGoalHolds,
} from "./run.js";
import { HOST_INJECT_CONTINUE } from "./live.js";
import { COMPARE_TASKS } from "./tasks.js";
import {
  geminiContentsIncludeHostDiverged,
  toolsForPolicy,
  toGeminiContents,
  type ModelClient,
  type ModelContent,
  type ModelMessage,
  type ModelToolCall,
} from "./model.js";

const MAX_INJECT_IDLE = 3;

export interface ProbeTurn {
  i: number;
  functionCallMode: "auto" | "any";
  assistantText: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  results: Array<{ status: string; issues: string[] }>;
  requestHasHostDiverged: boolean;
}

export interface HostDivergedProbeLog {
  task: "host_drift";
  policy: "structured";
  model: string;
  runIndex: number;
  delivery: "natural" | "forced_any" | "never";
  hostDivergedInGeminiPayload: boolean;
  modelSawDivergedInRequest: boolean;
  geminiFunctionResponseAfterDiverged?: unknown;
  understoodInText: boolean;
  calledSync: boolean;
  retriedAfterSync: boolean;
  recovered: boolean;
  finalTitle: string;
  turns: ProbeTurn[];
}

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

function issueCodes(result: CompactResult): string[] {
  return (result.issues ?? []).map((issue) => issue.code);
}

function mentionsDivergence(text: string): boolean {
  return /host[_\s-]?diverg|out of band|changed outside|call sync/i.test(text);
}

function isSyncName(name: string): boolean {
  return name === "scir.sync" || name === "sync";
}

function geminiResponseAfterDiverged(messages: ModelMessage[]): unknown {
  const contents = toGeminiContents(messages);
  for (const content of contents) {
    for (const part of content.parts) {
      const blob = JSON.stringify(part.functionResponse ?? {});
      if (blob.includes("host_diverged")) return part.functionResponse;
    }
  }
  return undefined;
}

/**
 * Structured-only live probe. Does not change host_drift recovery in the
 * compare loop. After the same inject/Continue path, if the model never
 * applied a post-inject action, one function-call-required turn is used so a
 * real host_diverged tool_result can exist in Gemini context. No recovery hint
 * is added to the prompt.
 */
export async function runHostDivergedProbe(
  client: ModelClient,
  options?: { runIndex?: number },
): Promise<HostDivergedProbeLog> {
  const task = COMPARE_TASKS.find((entry) => entry.id === "host_drift");
  if (!task) throw new Error("host_drift task missing");
  const adapter = new SlidesAdapter({ preset: task.fixture === "contrast" ? "contrast" : "default" });
  const session = new Session(adapter);
  const prompt = comparePrompt(session, task, "structured");
  let injected = injectHostIfDue(adapter, session, task, 0, false);
  const dispatcher = createDispatcher(session);
  const tools = toolsForPolicy("structured", toolDescriptors(session));
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `Goal: ${task.goalText}\nCurrent state: ${JSON.stringify(session.relevant())}`,
    },
  ];
  const turns: ProbeTurn[] = [];
  let idleAfterInject = 0;
  let usedForcedAny = false;
  let sawDivergedResult = false;
  let calledSync = false;
  let retriedAfterSync = false;
  let steps = 0;

  while (steps < task.maxSteps) {
    const needForcedAny = injected && !sawDivergedResult && idleAfterInject >= MAX_INJECT_IDLE && !usedForcedAny;
    const functionCallMode: "auto" | "any" = needForcedAny ? "any" : "auto";
    if (needForcedAny) usedForcedAny = true;

    const requestHasHostDiverged = geminiContentsIncludeHostDiverged(messages);
    const reply = await client.complete({
      system: prompt,
      tools,
      messages,
      ...(functionCallMode === "any" ? { functionCallMode: "any" as const } : {}),
    });

    if (reply.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: reply.text || "DONE" });
      turns.push({
        i: turns.length,
        functionCallMode,
        assistantText: reply.text || "DONE",
        toolCalls: [],
        results: [],
        requestHasHostDiverged,
      });
      if (!injected && task.inject && steps > 0) {
        injected = injectHostIfDue(adapter, session, task, steps, injected);
      }
      if (taskGoalHolds(adapter, session, task)) break;
      if (
        task.inject &&
        injected &&
        !taskGoalHolds(adapter, session, task) &&
        idleAfterInject < MAX_INJECT_IDLE &&
        steps < task.maxSteps
      ) {
        idleAfterInject += 1;
        messages.push({ role: "user", content: HOST_INJECT_CONTINUE });
        continue;
      }
      if (injected && !sawDivergedResult && !usedForcedAny) continue;
      break;
    }

    idleAfterInject = 0;
    const assistantContent = [
      ...(reply.text ? [{ type: "text" as const, text: reply.text }] : []),
      ...reply.toolCalls.map((call) => {
        const block: {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
          thoughtSignature?: string;
        } = { type: "tool_use", id: call.id, name: call.name, input: call.input };
        if (call.thoughtSignature) block.thoughtSignature = call.thoughtSignature;
        return block;
      }),
    ];
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults: ModelContent[] = [];
    const resultSummaries: ProbeTurn["results"] = [];
    for (const call of reply.toolCalls) {
      if (steps >= task.maxSteps) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ error: "step budget exhausted" }),
        });
        continue;
      }
      const name = resolveStructuredName(adapter.id, call.name);
      if (isSyncName(name)) calledSync = true;
      else if (calledSync) retriedAfterSync = true;

      let result: CompactResult & { rolledBack?: boolean };
      if (name === "scir.state" || name === "scir.describe" || name === "scir.transaction") {
        const bound = dispatcher(name, call.input);
        result = asCompact(session, bound);
      } else {
        const proposed = structuredProposed(adapter.id, call);
        result = performCompareStep(session, "structured", proposed, {}).result;
      }
      const codes = issueCodes(result);
      if (codes.includes("host_diverged")) sawDivergedResult = true;
      resultSummaries.push({ status: result.status, issues: codes });
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify({ result, state: session.relevant() }),
      });
      steps += 1;
      injected = injectHostIfDue(adapter, session, task, steps, injected);
    }
    messages.push({ role: "user", content: toolResults });
    turns.push({
      i: turns.length,
      functionCallMode,
      assistantText: reply.text,
      toolCalls: reply.toolCalls.map((call) => ({ name: call.name, input: cloneJson(call.input) })),
      results: resultSummaries,
      requestHasHostDiverged,
    });
  }

  const recovered = taskGoalHolds(adapter, session, task);
  const title =
    session.snapshot().objects.find((object) => object.id === "title_01")?.properties.text;
  const hostDivergedInGeminiPayload = geminiContentsIncludeHostDiverged(messages);
  const modelSawDivergedInRequest = turns.some((turn) => turn.requestHasHostDiverged);
  const delivery: HostDivergedProbeLog["delivery"] = sawDivergedResult
    ? usedForcedAny
      ? "forced_any"
      : "natural"
    : "never";

  return {
    task: "host_drift",
    policy: "structured",
    model: client.model,
    runIndex: options?.runIndex ?? 0,
    delivery,
    hostDivergedInGeminiPayload,
    modelSawDivergedInRequest,
    geminiFunctionResponseAfterDiverged: geminiResponseAfterDiverged(messages),
    understoodInText: turns.some((turn) => mentionsDivergence(turn.assistantText)),
    calledSync,
    retriedAfterSync,
    recovered,
    finalTitle: typeof title === "string" ? title : "missing",
    turns,
  };
}

export function formatHostDivergedProbe(logs: HostDivergedProbeLog[]): string {
  const lines: string[] = [];
  for (const log of logs) {
    lines.push(`run ${log.runIndex}  model=${log.model}  delivery=${log.delivery}`);
    lines.push(
      `  inGemini=${log.hostDivergedInGeminiPayload}  modelSawInRequest=${log.modelSawDivergedInRequest}  textUnderstands=${log.understoodInText}  sync=${log.calledSync}  retryAfterSync=${log.retriedAfterSync}  recovered=${log.recovered}  title=${JSON.stringify(log.finalTitle)}`,
    );
    for (const turn of log.turns) {
      const calls =
        turn.toolCalls.length === 0
          ? `text=${JSON.stringify(turn.assistantText.slice(0, 120))}`
          : turn.toolCalls
              .map((call, i) => {
                const result = turn.results[i];
                const issues = result?.issues.length ? result.issues.join(",") : result?.status ?? "";
                return `${call.name}(${JSON.stringify(call.input)}) → ${issues}`;
              })
              .join("; ");
      lines.push(`  t${turn.i} [${turn.functionCallMode}] reqDiverged=${turn.requestHasHostDiverged}  ${calls}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
