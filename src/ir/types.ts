export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type ObjectId = string;

export interface ScirObject {
  id: ObjectId;
  type: string;
  parent?: ObjectId;
  properties: Record<string, Json>;
}

export interface AdapterState {
  objects: ScirObject[];
  selection: ObjectId[];
  meta?: Record<string, Json>;
}

export interface State extends AdapterState {
  revision: number;
}

export interface Action {
  action: string;
  target?: ObjectId;
  params: Record<string, Json>;
  /** Rejected when it does not match the session revision. Stops a stale agent. */
  expectedRevision?: number;
}

export type PreconditionOp =
  | "eq"
  | "neq"
  | "exists"
  | "not_exists"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "contains";

export interface Precondition {
  path: string;
  op: PreconditionOp;
  value?: Json;
  message?: string;
}

export type ParamType = "string" | "number" | "boolean" | "array" | "object";

export interface ParamSpec {
  type: ParamType;
  required?: boolean;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface TargetSpec {
  required: boolean;
  types?: string[];
}

export type OperationLayer = "core" | "domain";

export interface Operation {
  name: string;
  description: string;
  layer: OperationLayer;
  target?: TargetSpec;
  params?: Record<string, ParamSpec>;
  preconditions?: Precondition[];
  reversible?: boolean;
  appliesWhenLocked?: boolean;
}

export type EffectKind = "create" | "update" | "delete" | "select";

export interface Effect {
  kind: EffectKind;
  target: ObjectId;
  path?: string;
  from?: Json;
  to?: Json;
}

export type ResultStatus = "accepted" | "rejected" | "failed";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ActionFocus {
  before?: ScirObject;
  after?: ScirObject;
}

export type RecoveryMechanism = "compensation" | "snapshot";

export interface ActionResult {
  status: ResultStatus;
  action: Action;
  revision: number;
  before: State;
  after: State;
  effects: Effect[];
  issues?: ValidationIssue[];
  focus?: ActionFocus;
  recovery?: RecoveryMechanism;
}

/** What an agent sees without paying for two full state copies. */
export interface CompactResult {
  status: ResultStatus;
  revision: number;
  effects: Effect[];
  issues?: ValidationIssue[];
  focus?: ActionFocus;
  recovery?: RecoveryMechanism;
}

export interface TransactionResult {
  status: ResultStatus;
  revision: number;
  before: State;
  after: State;
  effects: Effect[];
  results: ActionResult[];
  rolledBack: boolean;
  recovery?: RecoveryMechanism;
  issues?: ValidationIssue[];
}

export interface RevisionRecord {
  revision: number;
  timestamp: string;
  action: Action;
  effects: Effect[];
}

export interface StateQuery {
  ids?: ObjectId[];
  types?: string[];
  parent?: ObjectId;
}

export interface ExecuteOutcome {
  effects?: Effect[];
}

export interface AttemptRecord {
  status: ResultStatus;
  action: Action;
  revision: number;
  issues?: ValidationIssue[];
}

export interface RunMetrics {
  attempts: number;
  accepted: number;
  rejected: number;
  failed: number;
  revisions: number;
  latencyMs?: number;
  goal?: boolean;
}

export interface Trace {
  adapter: string;
  domain: string;
  actions: Action[];
}

export interface StateSize {
  objects: number;
  chars: number;
  approxTokens: number;
}

export interface Capabilities {
  transactions: boolean;
  compensation: boolean;
  snapshotRestore: boolean;
  relevantState: boolean;
  hierarchy: boolean;
}

export interface AdapterDescription {
  adapter: string;
  domain: string;
  capabilities: Capabilities;
  revision: number;
  objectTypes: string[];
  operations: { core: string[]; domain: string[] };
}
