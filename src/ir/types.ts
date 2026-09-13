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
}

export interface TargetSpec {
  required: boolean;
  types?: string[];
}

export interface Operation {
  name: string;
  description: string;
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

export interface ActionResult {
  status: ResultStatus;
  action: Action;
  revision: number;
  before: State;
  after: State;
  effects: Effect[];
  issues?: ValidationIssue[];
  focus?: ActionFocus;
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
}

export interface ExecuteOutcome {
  effects?: Effect[];
}
