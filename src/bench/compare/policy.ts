import type { CompareTaskId } from "./protocol.js";

export const TASK_CATEGORIES = ["execution", "gated", "vision-favorable"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_CATEGORY: Record<CompareTaskId, TaskCategory> = {
  rename_title: "execution",
  recolor_accent: "execution",
  add_callout: "execution",
  recolor_locked_logo: "gated",
  edit_hidden_slide: "gated",
  recover_title: "gated",
  abort_rebrand: "gated",
  host_drift: "gated",
  contrast_check: "vision-favorable",
};

export function isTaskCategory(value: string): value is TaskCategory {
  return (TASK_CATEGORIES as readonly string[]).includes(value);
}

export function categoryOf(task: CompareTaskId): TaskCategory {
  return TASK_CATEGORY[task];
}

// TODO: 제품 결정 필요. 값 정해지기 전까지 기본값은 "report_failed"로 둔다
// (안전한 기본값 — 락 걸린 대상을 에이전트가 임의로 풀지 않는 쪽)
export const LOCKED_TARGET_POLICY: "unlock_and_apply" | "report_failed" = "report_failed";

/** Grader for recolor_locked_logo. Do not hardcode a verdict elsewhere. */
export function lockedTargetFillAccepted(fillChanged: boolean): boolean {
  if (LOCKED_TARGET_POLICY === "unlock_and_apply") return fillChanged;
  return false;
}
