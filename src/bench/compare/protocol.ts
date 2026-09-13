export {
  COMPARE_PROTOCOL,
  STRUCTURED_PROMPT,
  VISION_PROMPT,
  VISION_TOOLS,
  VISION_TOOL_DESCRIPTORS,
  catalogToolList,
  fillComparePrompt,
} from "./prompts.js";
export type { VisionTool } from "./prompts.js";

export const COMPARE_POLICIES = ["structured", "vision"] as const;
export type ComparePolicy = (typeof COMPARE_POLICIES)[number];

export const COMPARE_TASK_IDS = [
  "rename_title",
  "recolor_accent",
  "recolor_locked_logo",
  "add_callout",
  "edit_hidden_slide",
  "recover_title",
  "abort_rebrand",
  "host_drift",
  "contrast_check",
] as const;

export type CompareTaskId = (typeof COMPARE_TASK_IDS)[number];

export function isCompareTaskId(id: string): id is CompareTaskId {
  return (COMPARE_TASK_IDS as readonly string[]).includes(id);
}

export const SEED_SHAPE_IDS = ["title_01", "accent_01", "logo_01", "body_02"] as const;

export function isSeedShapeId(id: string): boolean {
  return (SEED_SHAPE_IDS as readonly string[]).includes(id);
}
