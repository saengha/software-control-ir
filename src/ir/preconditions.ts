import type { Json, Precondition, ScirObject, State, ValidationIssue } from "./types.js";
import { getPath } from "./path.js";

function compare(left: unknown, right: unknown): number | undefined {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return undefined;
}

function contains(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === "string" && typeof needle === "string") {
    return haystack.includes(needle);
  }
  if (Array.isArray(haystack)) {
    return haystack.some((item) => JSON.stringify(item) === JSON.stringify(needle));
  }
  return false;
}

export function checkPrecondition(
  precondition: Precondition,
  target: ScirObject | undefined,
  state: State,
): ValidationIssue | undefined {
  const source = precondition.path.startsWith("$state.")
    ? getPath(state, precondition.path.slice("$state.".length))
    : target
      ? getPath(target, precondition.path)
      : undefined;

  const expected = precondition.value as Json | undefined;
  let ok = false;

  switch (precondition.op) {
    case "exists":
      ok = source !== undefined && source !== null;
      break;
    case "not_exists":
      ok = source === undefined || source === null;
      break;
    case "eq":
      ok = JSON.stringify(source) === JSON.stringify(expected);
      break;
    case "neq":
      ok = JSON.stringify(source) !== JSON.stringify(expected);
      break;
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const delta = compare(source, expected);
      if (delta === undefined) {
        ok = false;
        break;
      }
      ok =
        (precondition.op === "gt" && delta > 0) ||
        (precondition.op === "lt" && delta < 0) ||
        (precondition.op === "gte" && delta >= 0) ||
        (precondition.op === "lte" && delta <= 0);
      break;
    }
    case "contains":
      ok = contains(source, expected);
      break;
    default: {
      const neverOp: never = precondition.op;
      return { code: "unknown_operator", message: `Unknown operator ${neverOp}` };
    }
  }

  if (ok) return undefined;
  return {
    code: "precondition_failed",
    message: precondition.message ?? `Precondition failed: ${precondition.path} ${precondition.op}`,
    path: precondition.path,
  };
}

export function checkPreconditions(
  preconditions: Precondition[] | undefined,
  target: ScirObject | undefined,
  state: State,
): ValidationIssue[] {
  if (!preconditions) return [];
  const issues: ValidationIssue[] = [];
  for (const precondition of preconditions) {
    const issue = checkPrecondition(precondition, target, state);
    if (issue) issues.push(issue);
  }
  return issues;
}
