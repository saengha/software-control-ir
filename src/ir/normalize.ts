import type { Action, Json } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): Json {
  if (value === undefined) {
    throw new Error("undefined is not valid JSON");
  }
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeAction(raw: unknown): Action {
  if (!isPlainObject(raw) || typeof raw.action !== "string" || raw.action.length === 0) {
    throw Object.assign(new Error("Action must include a non-empty action name"), {
      code: "malformed_action",
    });
  }

  const target = raw.target;
  if (target !== undefined && typeof target !== "string") {
    throw Object.assign(new Error("Action target must be a string when present"), {
      code: "malformed_action",
    });
  }

  let params: Record<string, Json> = {};
  if (raw.params !== undefined) {
    if (!isPlainObject(raw.params)) {
      throw Object.assign(new Error("Action params must be an object"), {
        code: "malformed_action",
      });
    }
    params = cloneJson(raw.params) as Record<string, Json>;
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (key === "action" || key === "target" || key === "params") continue;
      params[key] = asJson(value);
    }
  }

  const action: Action = {
    action: raw.action,
    params,
  };
  if (typeof target === "string") {
    action.target = target;
  }
  return action;
}
