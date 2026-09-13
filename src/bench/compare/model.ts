import type { ToolDescriptor } from "../../transport/tools.js";
import { COMPARE_LIVE_MODEL, compareProvider } from "./settings.js";
import { VISION_TOOL_DESCRIPTORS } from "./prompts.js";
import type { ComparePolicy } from "./protocol.js";

export interface ModelTool {
  name: string;
  description: string;
  input_schema: ToolDescriptor["inputSchema"];
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface ModelImageContent {
  type: "image";
  source: { type: "base64"; media_type: "image/png"; data: string };
}

export type ToolResultPart = ModelImageContent | { type: "text"; text: string };

export type ModelContent =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content: string | ToolResultPart[] };

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ModelContent[] | AssistantContent[];
}

export type AssistantContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string };

export type FunctionCallMode = "auto" | "any";

export interface ModelRequest {
  system: string;
  tools: ModelTool[];
  messages: ModelMessage[];
  /** Default auto. Probe-only: force a function call without changing the prompt. */
  functionCallMode?: FunctionCallMode;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  stop: "tool" | "end";
}

export interface ModelClient {
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class RetryableModelError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableModelError) {
    return [408, 409, 429, 500, 502, 503, 529].includes(error.status);
  }
  if (error instanceof Error && /fetch|network|ECONNRESET|ETIMEDOUT|socket/i.test(error.message)) {
    return true;
  }
  return false;
}

export async function withBackoff<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let delay = 400;
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isRetryable(error) || i === attempts - 1) throw error;
      const wait = delay + Math.floor(Math.random() * 200);
      await new Promise((resolve) => setTimeout(resolve, wait));
      delay *= 2;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function structuredModelTools(descriptors: ToolDescriptor[]): ModelTool[] {
  return descriptors.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export function visionModelTools(): ModelTool[] {
  return VISION_TOOL_DESCRIPTORS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: { ...tool.inputSchema.properties },
      required: [...tool.inputSchema.required],
    },
  }));
}

export function toolsForPolicy(policy: ComparePolicy, descriptors: ToolDescriptor[]): ModelTool[] {
  return policy === "structured" ? structuredModelTools(descriptors) : visionModelTools();
}

interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  error?: { message?: string; type?: string };
}

export function createAnthropicClient(
  apiKey: string,
  model = COMPARE_LIVE_MODEL,
): ModelClient {
  return {
    model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return withBackoff(async () => {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
            body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: request.system,
            tools: request.tools,
            messages: request.messages,
            ...(request.functionCallMode === "any" ? { tool_choice: { type: "any" } } : {}),
          }),
        });
        const body = (await response.json()) as AnthropicResponse;
        if (!response.ok) {
          throw new RetryableModelError(
            response.status,
            body.error?.message ?? `Anthropic HTTP ${response.status}`,
          );
        }
        const toolCalls: ModelToolCall[] = [];
        const texts: string[] = [];
        for (const block of body.content ?? []) {
          if (block.type === "tool_use" && block.id && block.name) {
            toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
          }
          if (block.type === "text" && block.text) texts.push(block.text);
        }
        return {
          text: texts.join("\n"),
          toolCalls,
          stop: toolCalls.length > 0 ? "tool" : "end",
        };
      });
    },
  };
}

interface GeminiPart {
  text?: string;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  error?: { code?: number; message?: string; status?: string };
}

/** Gemini function names cannot contain `.`. */
export function geminiToolName(name: string): string {
  return name.replaceAll(".", "__");
}

export function fromGeminiToolName(name: string): string {
  return name.replaceAll("__", ".");
}

function asStruct(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isPlain(parsed)) return parsed;
    return { result: parsed };
  } catch {
    return { text };
  }
}

function generationConfig(model: string): Record<string, unknown> {
  const config: Record<string, unknown> = { maxOutputTokens: 2048 };
  if (model.includes("2.5")) config.thinkingConfig = { thinkingBudget: 0 };
  else if (model.includes("gemini-3")) config.thinkingConfig = { thinkingLevel: "minimal" };
  return config;
}

function geminiParameters(tool: ModelTool): Record<string, unknown> {
  const properties = tool.input_schema.properties ?? {};
  const required = tool.input_schema.required ?? [];
  const parameters: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) parameters.required = required;
  return parameters;
}

function toolNameById(messages: ModelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if ("type" in part && part.type === "tool_use") names.set(part.id, part.name);
    }
  }
  return names;
}

function toolResultParts(
  part: Extract<ModelContent, { type: "tool_result" }>,
  names: Map<string, string>,
): GeminiPart[] {
  const original = names.get(part.tool_use_id) ?? "unknown";
  const name = geminiToolName(original);
  if (typeof part.content === "string") {
    return [{ functionResponse: { name, response: asStruct(part.content) } }];
  }
  const out: GeminiPart[] = [];
  let response: Record<string, unknown> = {};
  for (const item of part.content) {
    if (item.type === "text") response = asStruct(item.text);
    else if (item.type === "image") {
      out.push({ inlineData: { mimeType: item.source.media_type, data: item.source.data } });
    }
  }
  out.unshift({ functionResponse: { name, response } });
  return out;
}

export function toGeminiContents(messages: ModelMessage[]): GeminiContent[] {
  const names = toolNameById(messages);
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      });
      continue;
    }
    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      for (const part of message.content as AssistantContent[]) {
        if (part.type === "text" && part.text) parts.push({ text: part.text });
        if (part.type === "tool_use") {
          const geminiPart: GeminiPart = {
            functionCall:
              Object.keys(part.input).length > 0
                ? { name: geminiToolName(part.name), args: part.input }
                : { name: geminiToolName(part.name) },
          };
          if (part.thoughtSignature) geminiPart.thoughtSignature = part.thoughtSignature;
          parts.push(geminiPart);
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    const parts: GeminiPart[] = [];
    for (const part of message.content as ModelContent[]) {
      if (part.type === "text") parts.push({ text: part.text });
      if (part.type === "tool_result") parts.push(...toolResultParts(part, names));
    }
    if (parts.length > 0) contents.push({ role: "user", parts });
  }
  return contents;
}

export function geminiContentsIncludeHostDiverged(messages: ModelMessage[]): boolean {
  return JSON.stringify(toGeminiContents(messages)).includes("host_diverged");
}

export function createGeminiClient(apiKey: string, model = COMPARE_LIVE_MODEL): ModelClient {
  return {
    model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return withBackoff(async () => {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: request.system }] },
              contents: toGeminiContents(request.messages),
              tools: [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: geminiToolName(tool.name),
                    description: tool.description,
                    parameters: geminiParameters(tool),
                  })),
                },
              ],
              generationConfig: generationConfig(model),
              ...(request.functionCallMode === "any"
                ? { toolConfig: { functionCallingConfig: { mode: "ANY" } } }
                : {}),
            }),
          },
        );
        const body = (await response.json()) as GeminiApiResponse;
        if (!response.ok) {
          throw new RetryableModelError(
            response.status,
            body.error?.message ?? `Gemini HTTP ${response.status}`,
          );
        }
        const parts = body.candidates?.[0]?.content?.parts ?? [];
        const toolCalls: ModelToolCall[] = [];
        const texts: string[] = [];
        let i = 0;
        for (const part of parts) {
          if (part.functionCall?.name) {
            i += 1;
            const call: ModelToolCall = {
              id: `gemini_${i}_${part.functionCall.name}`,
              name: fromGeminiToolName(part.functionCall.name),
              input: part.functionCall.args ?? {},
            };
            if (part.thoughtSignature) call.thoughtSignature = part.thoughtSignature;
            toolCalls.push(call);
          }
          if (part.text) texts.push(part.text);
        }
        return {
          text: texts.join("\n"),
          toolCalls,
          stop: toolCalls.length > 0 ? "tool" : "end",
        };
      });
    },
  };
}

export function createLiveClient(apiKey: string, model = COMPARE_LIVE_MODEL): ModelClient {
  return compareProvider() === "gemini" ? createGeminiClient(apiKey, model) : createAnthropicClient(apiKey, model);
}

export function parseStopVerdict(text: string): "DONE" | "FAILED" | undefined {
  const upper = text.toUpperCase();
  if (/(^|\b)DONE(\b|$)/.test(upper) && !/(^|\b)FAILED(\b|$)/.test(upper)) return "DONE";
  if (/(^|\b)FAILED(\b|$)/.test(upper)) return "FAILED";
  return undefined;
}

/**
 * Replay a frozen script as if a model issued those tool calls. Used to test
 * the live loop without spending API budget. Both policies still go through
 * the same loop and the same model id.
 */
export function createReplayClient(
  script: unknown[],
  model = COMPARE_LIVE_MODEL,
  adapterId = "slides",
): ModelClient {
  let i = 0;
  return {
    model,
    async complete(): Promise<ModelResponse> {
      const next = script[i];
      i += 1;
      if (next === undefined) {
        return { text: "DONE", toolCalls: [], stop: "end" };
      }
      return {
        text: "",
        toolCalls: [{ id: `replay_${i}`, name: replayToolName(next, adapterId), input: replayInput(next) }],
        stop: "tool",
      };
    },
  };
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replayToolName(raw: unknown, adapterId: string): string {
  if (!isPlain(raw)) return "unknown";
  if (typeof raw.tool === "string") return raw.tool;
  if (typeof raw.action === "string") {
    if (raw.action === "undo" || raw.action === "sync" || raw.action === "rollback") return `scir.${raw.action}`;
    return `${adapterId}.${raw.action}`;
  }
  return "unknown";
}

function replayInput(raw: unknown): Record<string, unknown> {
  if (!isPlain(raw)) return {};
  if (typeof raw.tool === "string") {
    const input: Record<string, unknown> = { ...raw };
    delete input.tool;
    return input;
  }
  const input: Record<string, unknown> = { ...raw };
  delete input.action;
  return input;
}
