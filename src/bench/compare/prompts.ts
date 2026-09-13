import type { Operation } from "../../ir/types.js";

export const COMPARE_PROTOCOL = {
  id: "scir-compare-v0",
  version: 3,
} as const;

export const STRUCTURED_PROMPT = `You control a slide editor through a structured tool API.
Available tools: {catalog}
Each call returns the resulting state and any validation error.
Goal: {goal}
You have {N} steps. Say DONE when the goal is met, or FAILED if you
cannot proceed.`;

export const VISION_PROMPT = `You control a slide editor by looking at screenshots and issuing
mouse/keyboard actions: click(x, y), type(text), scroll(direction),
right_click(x, y), screenshot().
You have no access to object IDs, lock state, or hidden-slide flags —
only what is visible in the rendered image and what the UI panels
show when you open them.
Goal: {goal}
You have {N} steps. Say DONE when the goal is met, or FAILED if you
cannot proceed.`;

export const VISION_TOOLS = ["click", "type", "scroll", "right_click", "screenshot"] as const;
export type VisionTool = (typeof VISION_TOOLS)[number];

export const VISION_TOOL_DESCRIPTORS = [
  {
    name: "screenshot",
    description: "Capture the current slide canvas and UI chrome. Coordinates for later clicks use this image.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "click",
    description: "Left-click at screenshot pixel (x, y). y < pad is the toolbar; y below the canvas is a slide tab.",
    inputSchema: {
      type: "object" as const,
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  {
    name: "right_click",
    description: "Right-click at screenshot pixel (x, y) to open the fill/text panel for the object there.",
    inputSchema: {
      type: "object" as const,
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  {
    name: "type",
    description: "Type into the current focus: text for a text box, fill hex when the fill panel is focused.",
    inputSchema: {
      type: "object" as const,
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "scroll",
    description: "Move to the next or previous slide tab.",
    inputSchema: {
      type: "object" as const,
      properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] } },
      required: ["direction"],
    },
  },
] as const;

export const VISION_FORBIDDEN_ACTIONS = new Set(["sync", "undo", "rollback"]);

const SESSION_TOOLS = ["undo", "sync"] as const;

export function catalogToolList(operations: Operation[]): string {
  const names = [...new Set([...operations.map((operation) => operation.name), ...SESSION_TOOLS])];
  return names.join(", ");
}

export function fillComparePrompt(
  template: string,
  input: { catalog: string; goal: string; n: number },
): string {
  return template
    .replaceAll("{catalog}", input.catalog)
    .replaceAll("{goal}", input.goal)
    .replaceAll("{N}", String(input.n));
}
