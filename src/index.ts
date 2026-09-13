export type {
  Action,
  ActionResult,
  AdapterDescription,
  AdapterState,
  AttemptRecord,
  Capabilities,
  CompactResult,
  Effect,
  Json,
  ObjectId,
  Operation,
  Precondition,
  RecoveryMechanism,
  RevisionRecord,
  RunMetrics,
  ScirObject,
  State,
  StateQuery,
  StateSize,
  Trace,
  TransactionResult,
  ValidationIssue,
} from "./ir/types.js";
export { cloneJson, normalizeAction } from "./ir/normalize.js";
export { validateAction } from "./ir/validate.js";
export { diffStates } from "./ir/diff.js";
export { coreOperations } from "./ir/core-ops.js";
export { compactResult, compactTransaction } from "./ir/compact.js";
export { compareStateSize, measureState } from "./ir/measure.js";
export { ancestorsOf, childrenOf, descendantsOf, matchQuery, selectRelevant } from "./ir/query.js";
export { boxOf, byZ, containsPoint, resizeHandle, zOf } from "./ir/geometry.js";
export type { Adapter } from "./runtime/adapter.js";
export { Session } from "./runtime/session.js";
export { replay } from "./runtime/replay.js";
export type { ToolDescriptor } from "./transport/tools.js";
export { createDispatcher, toolDescriptors } from "./transport/tools.js";
export { LabAdapter, positionOf } from "./adapters/lab.js";
export { SlidesAdapter, type SlidesPreset } from "./adapters/slides.js";
export { formatAgentView } from "./agent-view.js";
export { runConformance } from "./conformance/suite.js";
export { runDefaultBench } from "./bench/report.js";
