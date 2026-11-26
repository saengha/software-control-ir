import type { Json, RunMetrics } from "../src/index.js";

export type EvalTag = "normal" | "edge" | "adversarial";
export type EvalDifficulty = "easy" | "medium" | "hard";
export type EvalPolicy = "free-exec" | "scir";
export type EvalDriver = "deterministic-harness" | "live-llm";

export type SafetyViolationType =
  | "forbidden_api"
  | "locked_target_mutation"
  | "out_of_scope_mutation"
  | "host_drift_bypass"
  | "dirty_partial_mutation"
  | "prototype_pollution"
  | "invalid_param_bypass";

export type FailureCategory =
  | "none"
  | "schema_violation"
  | "wrong_tool"
  | "loop_repeat"
  | "context_overflow"
  | "safety_violation"
  | "execution_error"
  | "goal_mismatch";

export const EVAL_TAGS: readonly EvalTag[] = ["normal", "edge", "adversarial"];
export const EVAL_DIFFICULTIES: readonly EvalDifficulty[] = ["easy", "medium", "hard"];
export const EVAL_POLICIES: readonly EvalPolicy[] = ["free-exec", "scir"];
export const SAFETY_VIOLATION_TYPES: readonly SafetyViolationType[] = [
  "forbidden_api",
  "locked_target_mutation",
  "out_of_scope_mutation",
  "host_drift_bypass",
  "dirty_partial_mutation",
  "prototype_pollution",
  "invalid_param_bypass",
];
export const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "none",
  "schema_violation",
  "wrong_tool",
  "loop_repeat",
  "context_overflow",
  "safety_violation",
  "execution_error",
  "goal_mismatch",
];

export type EvalPreset = "board" | "contrast";

export interface PropertyExpect {
  id: string;
  path: string;
  equals: Json;
}

export interface EvalExpect {
  properties?: PropertyExpect[];
  activeSlide?: string;
  present?: string[];
  absent?: string[];
  unchangedIds?: string[];
  documentUnchanged?: boolean;
  rolledBack?: boolean;
  syncedDrift?: boolean;
}

export interface HostInjectTrigger {
  id: string;
  property: string;
  equals: Json;
}

export interface HostInjectSpec {
  action: string;
  params: Record<string, Json>;
  target?: string;
  trigger?: HostInjectTrigger;
}

export type EvalPlanStep =
  | { op: "apply"; action: Record<string, Json> }
  | { op: "transaction"; actions: Array<Record<string, Json>> }
  | { op: "undo" }
  | { op: "sync" }
  | { op: "host_inject" };

export interface EvalTask {
  id: string;
  tag: EvalTag;
  difficulty: EvalDifficulty;
  preset: EvalPreset;
  title: string;
  goal: string;
  prompt: string;
  scirPlan: EvalPlanStep[];
  baselineCode: string;
  expect: EvalExpect;
  allowedWriteIds?: string[];
  forbidLockedMutation?: boolean;
  hostInject?: HostInjectSpec;
}

export interface SafetyViolation {
  type: SafetyViolationType;
  taskId: string;
  policy: EvalPolicy;
  detail: string;
  targetId?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  usd: number;
}

export interface EvalTaskResult {
  taskId: string;
  tag: EvalTag;
  difficulty: EvalDifficulty;
  policy: EvalPolicy;
  driver: EvalDriver;
  passed: boolean;
  failureCategory: FailureCategory;
  latencyMs: number;
  safetyViolations: SafetyViolation[];
  expectationFailures: string[];
  issueCodes: string[];
  rolledBack: boolean;
  syncedDrift: boolean;
  tokenUsage: TokenUsage | null;
  metrics?: RunMetrics;
}

export interface LatencyStats {
  p50: number;
  p95: number;
  mean: number;
}

export interface SafetyTally {
  total: number;
  byType: Record<SafetyViolationType, number>;
  records: SafetyViolation[];
}

export interface TokenCost {
  promptTokens: number;
  completionTokens: number;
  usd: number;
  note: string;
}

export interface TagBreakdown {
  tasks: number;
  passed: number;
  safetyViolations: number;
}

export interface PolicyAggregate {
  policy: EvalPolicy;
  tasks: number;
  passed: number;
  passRate: number;
  safetyViolations: SafetyTally;
  latencyMs: LatencyStats;
  failureBreakdown: Record<FailureCategory, number>;
  tagBreakdown: Record<EvalTag, TagBreakdown>;
  failedTaskIds: string[];
  tokenCost: TokenCost | null;
}

export interface EvalSuiteReport {
  driver: EvalDriver;
  generatedAt: string;
  taskCount: number;
  tokenCostNote: string;
  policies: Record<EvalPolicy, PolicyAggregate>;
  results: EvalTaskResult[];
}

export const DETERMINISTIC_TOKEN_NOTE = "N/A (deterministic harness)";
