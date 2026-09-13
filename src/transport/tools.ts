import { compactResult, compactTransaction } from "../ir/compact.js";
import type { Operation, ParamSpec } from "../ir/types.js";
import type { Session } from "../runtime/session.js";

/**
 * Projects an adapter catalog as typed tool descriptors. This is the shape a
 * transport such as MCP could carry; the IR still owns state and validation.
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
}

function paramSchema(spec: ParamSpec): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: spec.type };
  if (spec.enum) schema.enum = spec.enum;
  if (spec.minimum !== undefined) schema.minimum = spec.minimum;
  if (spec.maximum !== undefined) schema.maximum = spec.maximum;
  if (spec.type === "array") schema.items = { type: "string" };
  return schema;
}

function operationTool(prefix: string, operation: Operation): ToolDescriptor {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  if (operation.target) {
    const types = operation.target.types;
    properties.target = types
      ? { type: "string", description: `id of a ${types.join(" or ")}` }
      : { type: "string", description: "object id" };
    if (operation.target.required) required.push("target");
  }
  for (const [name, spec] of Object.entries(operation.params ?? {})) {
    properties[name] = paramSchema(spec);
    if (spec.required) required.push(name);
  }

  return {
    name: `${prefix}.${operation.name}`,
    description: `${operation.description} (${operation.layer} layer)`,
    inputSchema: { type: "object", properties, required },
  };
}

const stateTools: ToolDescriptor[] = [
  {
    name: "scir.describe",
    description: "Adapter id, capabilities, object types, and available operations.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scir.state",
    description: "Structured state. Defaults to the relevant slice instead of the whole document.",
    inputSchema: {
      type: "object",
      properties: { scope: { type: "string", enum: ["relevant", "full"] } },
      required: [],
    },
  },
  {
    name: "scir.transaction",
    description: "Apply a batch that either lands completely or leaves no changes behind.",
    inputSchema: {
      type: "object",
      properties: { actions: { type: "array", items: { type: "object" } } },
      required: ["actions"],
    },
  },
  {
    name: "scir.undo",
    description: "Undo the newest revision, by inverse action when available.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scir.rollback",
    description: "Restore an earlier revision.",
    inputSchema: {
      type: "object",
      properties: { revision: { type: "number", minimum: 0 } },
      required: ["revision"],
    },
  },
];

export function toolDescriptors(session: Session): ToolDescriptor[] {
  return [
    ...stateTools,
    ...session.catalog().map((operation) => operationTool(session.adapterId, operation)),
  ];
}

export interface ToolError {
  error: { code: string; message: string };
}

function toolError(code: string, message: string): ToolError {
  return { error: { code, message } };
}

/**
 * Dispatches a tool call against a session. Results stay compact: an agent that
 * already holds the state does not need two more copies of it.
 */
export function createDispatcher(session: Session) {
  return function call(name: string, args: Record<string, unknown> = {}): unknown {
    switch (name) {
      case "scir.describe":
        return session.describe();
      case "scir.state":
        return args.scope === "full" ? session.snapshot() : session.relevant();
      case "scir.transaction": {
        if (!Array.isArray(args.actions)) {
          return toolError("invalid_params", "actions must be an array");
        }
        return compactTransaction(session.transaction(args.actions));
      }
      case "scir.undo":
        return compactResult(session.undo());
      case "scir.rollback": {
        const revision = args.revision;
        if (typeof revision !== "number") {
          return toolError("invalid_params", "revision must be a number");
        }
        return compactResult(session.rollback(revision));
      }
      default:
        break;
    }

    const prefix = `${session.adapterId}.`;
    if (!name.startsWith(prefix)) {
      return toolError("unknown_tool", `No tool named "${name}"`);
    }

    const operation = name.slice(prefix.length);
    const { target, ...params } = args;
    const action: Record<string, unknown> = { action: operation, params };
    if (typeof target === "string") action.target = target;
    return compactResult(session.apply(action));
  };
}
