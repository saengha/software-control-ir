import { checkPreconditions } from "./preconditions.js";
import { isLocked } from "./path.js";
import type {
  Action,
  Operation,
  ParamSpec,
  ScirObject,
  State,
  ValidationIssue,
} from "./types.js";

function findOperation(catalog: Operation[], name: string): Operation | undefined {
  return catalog.find((operation) => operation.name === name);
}

function findObject(state: State, id: string | undefined): ScirObject | undefined {
  if (!id) return undefined;
  return state.objects.find((object) => object.id === id);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkParam(name: string, spec: ParamSpec, value: unknown): ValidationIssue | undefined {
  if (value === undefined) {
    if (spec.required) {
      return {
        code: "invalid_params",
        message: `Missing required param "${name}"`,
        path: name,
      };
    }
    return undefined;
  }

  const actual = typeName(value);
  if (actual !== spec.type) {
    return {
      code: "invalid_params",
      message: `Param "${name}" must be ${spec.type}`,
      path: name,
    };
  }

  if (spec.type === "number" && typeof value === "number") {
    if (spec.minimum !== undefined && value < spec.minimum) {
      return {
        code: "invalid_params",
        message: `Param "${name}" must be >= ${spec.minimum}`,
        path: name,
      };
    }
    if (spec.maximum !== undefined && value > spec.maximum) {
      return {
        code: "invalid_params",
        message: `Param "${name}" must be <= ${spec.maximum}`,
        path: name,
      };
    }
  }

  return undefined;
}

export function validateAction(
  action: Action,
  state: State,
  catalog: Operation[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const operation = findOperation(catalog, action.action);

  if (!operation) {
    return [
      {
        code: "unknown_operation",
        message: `Operation "${action.action}" is not in the adapter catalog`,
      },
    ];
  }

  const targetSpec = operation.target;
  if (targetSpec?.required && !action.target) {
    issues.push({
      code: "missing_target",
      message: `Operation "${operation.name}" requires a target`,
    });
  }

  const target = findObject(state, action.target);
  if (action.target && !target) {
    issues.push({
      code: "unknown_target",
      message: `Target "${action.target}" does not exist`,
      path: "target",
    });
  }

  if (target && targetSpec?.types && !targetSpec.types.includes(target.type)) {
    issues.push({
      code: "type_mismatch",
      message: `Target "${target.id}" is type "${target.type}", expected ${targetSpec.types.join(", ")}`,
      path: "target",
    });
  }

  const paramSpecs = operation.params ?? {};
  for (const [name, spec] of Object.entries(paramSpecs)) {
    const issue = checkParam(name, spec, action.params[name]);
    if (issue) issues.push(issue);
  }

  for (const name of Object.keys(action.params)) {
    if (!(name in paramSpecs)) {
      issues.push({
        code: "invalid_params",
        message: `Unknown param "${name}"`,
        path: name,
      });
    }
  }

  if (target && isLocked(target) && operation.appliesWhenLocked !== true) {
    issues.push({
      code: "locked",
      message: `Target "${target.id}" is locked`,
      path: "properties.locked",
    });
  }

  issues.push(...checkPreconditions(operation.preconditions, target, state));
  return issues;
}
