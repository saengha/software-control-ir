export type {
  Action,
  ActionResult,
  AdapterDescription,
  AdapterState,
  AttemptRecord,
  Capabilities,
  CompactResult,
  Effect,
  ExecuteOutcome,
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
export { cloneJson, normalizeAction, sameJson } from "./ir/normalize.js";
export { validateAction } from "./ir/validate.js";
export { diffStates } from "./ir/diff.js";
export { coreOperations } from "./ir/core-ops.js";
export { compactResult, compactTransaction } from "./ir/compact.js";
export { compareStateSize, measureState } from "./ir/measure.js";
export { ancestorsOf, childrenOf, descendantsOf, matchQuery, selectRelevant } from "./ir/query.js";
export { boxOf, byZ, containsPoint, resizeHandle, zOf } from "./ir/geometry.js";
export type { Adapter } from "./runtime/adapter.js";
export { Session } from "./runtime/session.js";
export { hostOwned } from "./runtime/host-owned.js";
export { replay } from "./runtime/replay.js";
export type { ToolDescriptor } from "./transport/tools.js";
export { createDispatcher, toolDescriptors } from "./transport/tools.js";
export { LabAdapter, positionOf } from "./adapters/lab.js";
export { SlidesAdapter, type SlidesPreset } from "./adapters/slides.js";
export {
  ImpressAdapter,
  copyImpressDocument,
  defaultImpressContrastDocument,
  defaultImpressDocument,
  libreOfficeProgram,
} from "./adapters/impress.js";
export type { ImpressAdapterOptions, ImpressIsolation } from "./adapters/impress.js";
export { formatAgentView } from "./agent-view.js";
export { runConformance } from "./conformance/suite.js";
export { runDefaultBench } from "./bench/report.js";
export {
  COMPARE_LIVE_MODEL,
  COMPARE_OVERALL_WARNING,
  COMPARE_POLICIES,
  COMPARE_PROTOCOL,
  COMPARE_REPEATS,
  COMPARE_TASK_IDS,
  COMPARE_TASKS,
  HOST_DRIFT_AFTER_STEPS,
  LOCKED_TARGET_POLICY,
  STRUCTURED_PROMPT,
  TASK_CATEGORIES,
  TASK_CATEGORY,
  VISION_PROMPT,
  bindPolicyAction,
  catalogToolList,
  categoryOf,
  compareProvider,
  contrastRatio,
  createAnthropicClient,
  createGeminiClient,
  createLiveClient,
  createReplayClient,
  encodePpm,
  fillComparePrompt,
  formatCompareTable,
  fromGeminiToolName,
  geminiToolName,
  gradeRenderedContrast,
  isCompareTaskId,
  liveApiKey,
  lockedTargetFillAccepted,
  migrateExperimentLog,
  migrateExperimentLogs,
  observeStructured,
  observeVision,
  parseCompareArgs,
  parseCompareCategory,
  parseCompareTasks,
  renderSlideRaster,
  repeatStats,
  runCompare,
  runCompareLive,
  runCompareSuite,
  runCompareSuiteLive,
  runSlidesCompare,
  runSlidesCompareLive,
  sampleStdev,
  toGeminiContents,
  visionJsonContainsSecrets,
  visionToolFeedback,
  withBackoff,
} from "./bench/compare/index.js";
export type {
  CompareCliOptions,
  CompareDriver,
  CompareFixture,
  CompareMetrics,
  ComparePolicy,
  CompareProvider,
  CompareRunLog,
  CompareRunOptions,
  CompareStepLog,
  CompareTask,
  CompareTaskId,
  CompareVerdict,
  ContrastGrade,
  ModelClient,
  RepeatStats,
  SlideRaster,
  TaskCategory,
} from "./bench/compare/index.js";
