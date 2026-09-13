import type { ToolDescriptor } from "../../transport/tools.js";
import { COMPARE_LIVE_MODEL } from "./settings.js";
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
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface ModelRequest {
  system: string;
  tools: ModelTool[];
  messages: ModelMessage[];
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
