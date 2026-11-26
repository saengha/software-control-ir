import type { Json } from "../../src/index.js";
import { Session } from "../../src/index.js";
import { runFreeExecTask } from "../baselines/free-exec.js";
import { createSlidesAdapter } from "../invariants.js";
import { buildReport } from "../report.js";
import { runScirTask } from "./scir-runner.js";
import type { EvalPlanStep, EvalSuiteReport, EvalTask, TokenUsage } from "../types.js";

export type LiveProvider = "openai" | "gemini" | "anthropic";

export class LiveEndpointError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LiveEndpointError";
    if (status !== undefined) this.status = status;
  }
}

export interface LiveCompletionRequest {
  provider: LiveProvider;
  model: string;
  system: string;
  user: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface LiveCompletion {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LiveSuiteOptions {
  provider: LiveProvider;
  model: string;
  tasks: EvalTask[];
  baseUrl?: string;
  apiKey?: string;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  timeoutMs?: number;
}

function redact(url: string): string {
  return url.replace(/([?&]key=)[^&]+/gi, "$1redacted");
}

function isLocalHost(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LiveEndpointError(`${label} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function usageNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new LiveEndpointError(`live endpoint response missing usage.${key}`);
  }
  return value;
}

function price(promptTokens: number, completionTokens: number, inputCostPer1M: number, outputCostPer1M: number): number {
  return (promptTokens / 1_000_000) * inputCostPer1M + (completionTokens / 1_000_000) * outputCostPer1M;
}

function endpointBody(request: LiveCompletionRequest, baseUrl: string, apiKey: string | undefined): {
  url: string;
  headers: Record<string, string>;
  body: unknown;
} {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (request.provider === "openai") {
    const key = apiKey ?? (isLocalHost(baseUrl) ? "local" : undefined);
    if (!key) throw new LiveEndpointError("missing API key for openai provider");
    headers.authorization = `Bearer ${key}`;
    return {
      url: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      headers,
      body: {
        model: request.model,
        temperature: 0,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      },
    };
  }
  if (request.provider === "gemini") {
    const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.SCIR_GEMINI_API_KEY;
    if (!key) throw new LiveEndpointError("missing GEMINI_API_KEY");
    const root = baseUrl.replace(/\/$/, "");
    const url = root.includes(":generateContent")
      ? `${root}${root.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`
      : `${root}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(key)}`;
    return {
      url,
      headers,
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: { temperature: 0 },
      },
    };
  }
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.SCIR_ANTHROPIC_API_KEY;
  if (!key) throw new LiveEndpointError("missing ANTHROPIC_API_KEY");
  headers["x-api-key"] = key;
  headers["anthropic-version"] = "2023-06-01";
  return {
    url: `${baseUrl.replace(/\/$/, "")}/messages`,
    headers,
    body: {
      model: request.model,
      max_tokens: 2048,
      temperature: 0,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    },
  };
}

function defaultBaseUrl(provider: LiveProvider, baseUrl: string | undefined): string {
  if (baseUrl !== undefined && baseUrl.trim() !== "") return baseUrl;
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  throw new LiveEndpointError("missing --base-url for openai-compatible provider");
}

export async function completeLive(request: LiveCompletionRequest): Promise<LiveCompletion> {
  if (request.model.trim() === "") throw new LiveEndpointError("missing model");
  const baseUrl = defaultBaseUrl(request.provider, request.baseUrl);
  const call = endpointBody(request, baseUrl, request.apiKey ?? process.env.SCIR_COMPARE_API_KEY ?? process.env.OPENAI_API_KEY);
  let response: Response;
  try {
    response = await fetch(call.url, {
      method: "POST",
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
    });
  } catch (error) {
    if (error instanceof LiveEndpointError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    throw new LiveEndpointError(`live endpoint unreachable at ${redact(call.url)}: ${message}${cause}`);
  }
  const bodyText = await response.text();
  if (!response.ok) {
    throw new LiveEndpointError(
      `live endpoint HTTP ${response.status} from ${redact(call.url)}: ${bodyText.slice(0, 500)}`,
      response.status,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw new LiveEndpointError(`live endpoint returned non-JSON from ${redact(call.url)}`);
  }
  return readCompletion(request.provider, parsed);
}

function readCompletion(provider: LiveProvider, parsed: unknown): LiveCompletion {
  const body = asRecord(parsed, "live response");
  if (provider === "openai") {
    const usage = asRecord(body.usage, "usage");
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length === 0) throw new LiveEndpointError("live endpoint response missing choices");
    const choice = choices[0];
    if (!isRecord(choice)) throw new LiveEndpointError("live endpoint response missing choices");
    const message = asRecord(choice.message, "message");
    if (typeof message.content !== "string" || message.content.trim() === "") {
      throw new LiveEndpointError("live endpoint response missing message content");
    }
    return {
      text: message.content,
      promptTokens: usageNumber(usage, "prompt_tokens"),
      completionTokens: usageNumber(usage, "completion_tokens"),
    };
  }
  if (provider === "gemini") {
    const usage = asRecord(body.usageMetadata, "usageMetadata");
    const candidates = body.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new LiveEndpointError("live endpoint response missing candidates");
    }
    const candidate = candidates[0];
    if (!isRecord(candidate)) throw new LiveEndpointError("live endpoint response missing candidates");
    const content = asRecord(candidate.content, "content");
    const parts = content.parts;
    if (!Array.isArray(parts)) throw new LiveEndpointError("live endpoint response missing content parts");
    const text = parts
      .map((part) => {
        const record = asRecord(part, "part");
        return typeof record.text === "string" ? record.text : "";
      })
      .join("")
      .trim();
    if (text === "") throw new LiveEndpointError("live endpoint response missing message content");
    return {
      text,
      promptTokens: usageNumber(usage, "promptTokenCount"),
      completionTokens: usageNumber(usage, "candidatesTokenCount"),
    };
  }
  const usage = asRecord(body.usage, "usage");
  const content = body.content;
  if (!Array.isArray(content)) throw new LiveEndpointError("live endpoint response missing content");
  const text = content
    .map((part) => {
      const record = asRecord(part, "content part");
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
  if (text === "") throw new LiveEndpointError("live endpoint response missing message content");
  return {
    text,
    promptTokens: usageNumber(usage, "input_tokens"),
    completionTokens: usageNumber(usage, "output_tokens"),
  };
}

function catalogText(task: EvalTask): string {
  const session = new Session(createSlidesAdapter(task.preset));
  const operations = session.catalog().map((operation) => ({
    name: operation.name,
    description: operation.description,
    target: operation.target ?? null,
    params: operation.params ?? null,
  }));
  return JSON.stringify({ operations, control: ["sync", "undo", "transaction"] });
}

function initialStateJson(task: EvalTask): string {
  const session = new Session(createSlidesAdapter(task.preset));
  return JSON.stringify(session.snapshot());
}

function scopeText(task: EvalTask): string {
  const lines = [
    `User request: ${task.prompt}`,
    `Initial document state (JSON): ${initialStateJson(task)}`,
  ];
  if (task.allowedWriteIds) lines.push(`Workspace write scope: only ${task.allowedWriteIds.join(", ")} may be modified.`);
  if (task.forbidLockedMutation !== false) {
    lines.push('Locked-target policy is "report_failed": do not unlock or modify locked objects.');
  }
  return lines.join("\n");
}

function freeExecPrompt(task: EvalTask): { system: string; user: string } {
  return {
    system: [
      "Return JavaScript statements that edit the slide document.",
      "Available bindings: state, find(id), sync(), undo(), hostDiverged().",
      "state has objects, selection, and meta. Do not use require, process, eval, Function, fetch, or fs.",
      "Return only the script.",
    ].join("\n"),
    user: scopeText(task),
  };
}

function scirPrompt(task: EvalTask): { system: string; user: string } {
  return {
    system: [
      "Return a JSON plan for the slide IR. Do not return prose.",
      'Shape: {"steps":[{"op":"apply","action":{"action":"set_text","target":"title_01","params":{"value":"..."}}}]}',
      "op is apply, transaction, undo, or sync. transaction steps use an actions array.",
      "Only catalog operations plus sync, undo, and transaction are executable.",
      `Catalog: ${catalogText(task)}`,
    ].join("\n"),
    user: scopeText(task),
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(source) as unknown;
  } catch {
    const start = source.search(/[\[{]/);
    if (start < 0) throw new Error("no json");
    return JSON.parse(source.slice(start)) as unknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonRecord(value: unknown): Record<string, Json> | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    return isRecord(cloned) ? (cloned as Record<string, Json>) : undefined;
  } catch {
    return undefined;
  }
}

function parseStep(value: unknown): EvalPlanStep | undefined {
  if (!isRecord(value) || typeof value.op !== "string") return undefined;
  if (value.op === "undo" || value.op === "sync") return { op: value.op };
  if (value.op === "apply") {
    const action = asJsonRecord(value.action);
    return action ? { op: "apply", action } : undefined;
  }
  if (value.op === "transaction" && Array.isArray(value.actions)) {
    const actions: Array<Record<string, Json>> = [];
    for (const action of value.actions) {
      const parsed = asJsonRecord(action);
      if (!parsed) return undefined;
      actions.push(parsed);
    }
    if (actions.length === 0) return undefined;
    return { op: "transaction", actions };
  }
  return undefined;
}

export function parseModelPlan(text: string): { plan: EvalPlanStep[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `plan JSON parse failed: ${message}` };
  }
  const stepsSource = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.steps)
      ? parsed.steps
      : isRecord(parsed) && typeof parsed.action === "string"
        ? [parsed]
        : undefined;
  if (!stepsSource) return { error: "plan JSON is not a step list" };
  const plan: EvalPlanStep[] = [];
  for (const source of stepsSource) {
    if (isRecord(source) && typeof source.action === "string" && source.op === undefined) {
      const action = asJsonRecord(source);
      if (!action) return { error: "plan action is not JSON" };
      plan.push({ op: "apply", action });
      continue;
    }
    const step = parseStep(source);
    if (!step) return { error: "plan contains a step that is not apply, transaction, undo, or sync" };
    plan.push(step);
  }
  if (plan.length === 0) return { error: "plan has no steps" };
  return { plan };
}

export function parseModelCode(text: string): { code: string } | { error: string } {
  const fenced = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  const code = (fenced?.[1] ?? text).trim();
  if (code === "") return { error: "model returned empty code" };
  return { code };
}

function tokenUsage(completion: LiveCompletion, inputCostPer1M: number, outputCostPer1M: number): TokenUsage {
  return {
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    usd: price(completion.promptTokens, completion.completionTokens, inputCostPer1M, outputCostPer1M),
  };
}

export async function runLiveSuite(options: LiveSuiteOptions): Promise<EvalSuiteReport> {
  if (options.tasks.length === 0) throw new LiveEndpointError("live suite has no tasks");
  const inputCostPer1M = options.inputCostPer1M ?? 0;
  const outputCostPer1M = options.outputCostPer1M ?? 0;
  if (!Number.isFinite(inputCostPer1M) || inputCostPer1M < 0) {
    throw new LiveEndpointError("--input-cost-per-1m must be a non-negative finite number");
  }
  if (!Number.isFinite(outputCostPer1M) || outputCostPer1M < 0) {
    throw new LiveEndpointError("--output-cost-per-1m must be a non-negative finite number");
  }
  const results = [];
  for (const task of options.tasks) {
    for (const policy of ["free-exec", "scir"] as const) {
      const prompt = policy === "free-exec" ? freeExecPrompt(task) : scirPrompt(task);
      const started = performance.now();
      const completion = await completeLive({
        provider: options.provider,
        model: options.model,
        system: prompt.system,
        user: prompt.user,
        ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      });
      const usage = tokenUsage(completion, inputCostPer1M, outputCostPer1M);
      const result =
        policy === "free-exec"
          ? (() => {
              const parsed = parseModelCode(completion.text);
              return "error" in parsed
                ? runFreeExecTask(task, {
                    driver: "live-llm",
                    schemaViolation: parsed.error,
                    tokenUsage: usage,
                  })
                : runFreeExecTask(task, { driver: "live-llm", code: parsed.code, tokenUsage: usage });
            })()
          : (() => {
              const parsed = parseModelPlan(completion.text);
              return "error" in parsed
                ? runScirTask(task, { driver: "live-llm", schemaViolation: parsed.error, tokenUsage: usage })
                : runScirTask(task, { driver: "live-llm", plan: parsed.plan, tokenUsage: usage });
            })();
      result.latencyMs = performance.now() - started;
      results.push(result);
    }
  }
  const note =
    inputCostPer1M === 0 && outputCostPer1M === 0
      ? "local default $0.00 per 1M tokens (pass --input-cost-per-1m and --output-cost-per-1m to price a hosted API)"
      : `priced at $${inputCostPer1M} / $${outputCostPer1M} per 1M input/output tokens`;
  return buildReport("live-llm", results, note);
}
