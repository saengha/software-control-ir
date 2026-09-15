import type { ToolDescriptor } from "../../transport/tools.js";
import { COMPARE_LIVE_MODEL, compareBaseUrl, compareProvider } from "./settings.js";
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
  if (error instanceof Error && /fetch|network|ECONNRESET|ETIMEDOUT|socket|aborted|timeout/i.test(error.message)) {
    return true;
  }
  if (error instanceof Error && error.name === "TimeoutError") return true;
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

/** Anthropic tool names are [a-zA-Z0-9_-]. Catalog ids use dots (`slides.set_text`). */
export function toAnthropicMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") return message;
    if (message.role !== "assistant") return message;
    return {
      role: "assistant",
      content: (message.content as AssistantContent[]).map((part) =>
        part.type === "tool_use" ? { ...part, name: wireToolName(part.name) } : part,
      ),
    };
  });
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
            tools: request.tools.map((tool) => ({
              name: wireToolName(tool.name),
              description: tool.description,
              input_schema: tool.input_schema,
            })),
            messages: toAnthropicMessages(request.messages),
            ...(request.functionCallMode === "any" ? { tool_choice: { type: "any" } } : {}),
          }),
          signal: AbortSignal.timeout(600_000),
        });
        const body = (await response.json()) as AnthropicResponse;
        if (!response.ok) {
          const message = body.error?.message ?? `Anthropic HTTP ${response.status}`;
          if ([408, 409, 429, 500, 502, 503, 529].includes(response.status)) {
            throw new RetryableModelError(response.status, message);
          }
          throw new Error(message);
        }
        const toolCalls: ModelToolCall[] = [];
        const texts: string[] = [];
        for (const block of body.content ?? []) {
          if (block.type === "tool_use" && block.id && block.name) {
            toolCalls.push({
              id: block.id,
              name: fromWireToolName(block.name),
              input: block.input ?? {},
            });
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

/** Gemini, OpenAI, and Anthropic function names cannot contain `.`. */
export function wireToolName(name: string): string {
  return name.replaceAll(".", "__");
}

export function fromWireToolName(name: string): string {
  return name.replaceAll("__", ".");
}

/** @deprecated Use wireToolName. Kept so existing tests keep compiling. */
export function geminiToolName(name: string): string {
  return wireToolName(name);
}

export function fromGeminiToolName(name: string): string {
  return fromWireToolName(name);
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
  const name = wireToolName(original);
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
                ? { name: wireToolName(part.name), args: part.input }
                : { name: wireToolName(part.name) },
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
                    name: wireToolName(tool.name),
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
              name: fromWireToolName(part.functionCall.name),
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

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<Record<string, unknown>> | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiApiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
  error?: { message?: string; type?: string; code?: string };
}

export function openaiChatUrl(baseUrl = compareBaseUrl() ?? "https://api.openai.com/v1"): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlain(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function toOpenAiMessages(system: string, messages: ModelMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role === "assistant" ? "assistant" : "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const parts = message.content as AssistantContent[];
      const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const toolCalls: OpenAiToolCall[] = parts
        .filter((part) => part.type === "tool_use")
        .map((part) => ({
          id: part.id,
          type: "function",
          function: { name: wireToolName(part.name), arguments: JSON.stringify(part.input ?? {}) },
        }));
      const assistant: OpenAiMessage = { role: "assistant", content: text.length > 0 ? text : null };
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
      out.push(assistant);
      continue;
    }
    const images: ModelImageContent[] = [];
    for (const part of message.content as ModelContent[]) {
      if (part.type === "text") {
        out.push({ role: "user", content: part.text });
        continue;
      }
      if (part.type !== "tool_result") continue;
      let text = "{}";
      if (typeof part.content === "string") {
        text = part.content;
      } else {
        for (const item of part.content) {
          if (item.type === "text") text = item.text;
          else if (item.type === "image") images.push(item);
        }
      }
      out.push({ role: "tool", tool_call_id: part.tool_use_id, content: text });
    }
    if (images.length > 0) {
      out.push({
        role: "user",
        content: images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.source.media_type};base64,${image.source.data}` },
        })),
      });
    }
  }
  return dropStaleOpenAiImages(out);
}

function isImageUserMessage(message: OpenAiMessage): boolean {
  return (
    message.role === "user" &&
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );
}

/** vLLM / many VLMs cap images per prompt. Keep the current screenshot only. */
function dropStaleOpenAiImages(messages: OpenAiMessage[]): OpenAiMessage[] {
  let last = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (isImageUserMessage(messages[i])) last = i;
  }
  if (last < 0) return messages;
  return messages.filter((message, i) => !isImageUserMessage(message) || i === last);
}

function qwenLocalExtras(model: string, baseUrl: string): Record<string, unknown> {
  const local = /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(baseUrl);
  if (!/qwen/i.test(model) && !local) return {};
  if (!/qwen/i.test(model)) return {};
  return {
    temperature: 1,
    top_p: 0.95,
    chat_template_kwargs: { enable_thinking: false },
  };
}

export function parseContextHeadroom(message: string): number | undefined {
  const max = message.match(/maximum context length is (\d+)/i);
  const input = message.match(/prompt contains at least (\d+) input tokens/i);
  if (!max || !input) return undefined;
  return Math.max(64, Number(max[1]) - Number(input[1]) - 32);
}

export function defaultOpenAiMaxTokens(model: string, baseUrl: string): number {
  if (/qwen/i.test(model) || /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(baseUrl)) return 1024;
  return 2048;
}

export function createOpenAiClient(
  apiKey: string,
  model = COMPARE_LIVE_MODEL,
  baseUrl = compareBaseUrl() ?? "https://api.openai.com/v1",
): ModelClient {
  const url = openaiChatUrl(baseUrl);
  return {
    model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return withBackoff(async () => {
        let maxTokens = defaultOpenAiMaxTokens(model, baseUrl);
        let retriedContext = false;
        while (true) {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              messages: toOpenAiMessages(request.system, request.messages),
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: wireToolName(tool.name),
                  description: tool.description,
                  parameters: {
                    type: "object",
                    properties: tool.input_schema.properties ?? {},
                    ...(tool.input_schema.required && tool.input_schema.required.length > 0
                      ? { required: tool.input_schema.required }
                      : {}),
                  },
                },
              })),
              tool_choice: request.functionCallMode === "any" ? "required" : "auto",
              ...qwenLocalExtras(model, baseUrl),
            }),
            signal: AbortSignal.timeout(600_000),
          });
          const body = (await response.json()) as OpenAiApiResponse;
          if (!response.ok) {
            const err = body.error?.message ?? `OpenAI HTTP ${response.status}`;
            const headroom = parseContextHeadroom(err);
            if (!retriedContext && headroom !== undefined && headroom < maxTokens) {
              retriedContext = true;
              maxTokens = headroom;
              continue;
            }
            if ([408, 409, 429, 500, 502, 503, 529].includes(response.status)) {
              throw new RetryableModelError(response.status, err);
            }
            throw new Error(err);
          }
          const message = body.choices?.[0]?.message;
          const toolCalls: ModelToolCall[] = [];
          let i = 0;
          for (const call of message?.tool_calls ?? []) {
            if (!call.function?.name) continue;
            i += 1;
            toolCalls.push({
              id: call.id ?? `openai_${i}_${call.function.name}`,
              name: fromWireToolName(call.function.name),
              input: parseToolArguments(call.function.arguments),
            });
          }
          return {
            text: message?.content ?? "",
            toolCalls,
            stop: toolCalls.length > 0 ? "tool" : "end",
          };
        }
      });
    },
  };
}

export function createLiveClient(apiKey: string, model = COMPARE_LIVE_MODEL): ModelClient {
  const provider = compareProvider();
  if (provider === "gemini") return createGeminiClient(apiKey, model);
  if (provider === "openai") return createOpenAiClient(apiKey, model);
  return createAnthropicClient(apiKey, model);
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
