import type { Action, AdapterState, Operation, ScirObject, State, StateQuery, ValidationIssue } from "../ir/types.js";
import { coreOperations } from "../ir/core-ops.js";
import { cloneJson } from "../ir/normalize.js";
import { matchQuery } from "../ir/query.js";
import type { Adapter } from "../runtime/adapter.js";

function asNumberPair(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}

const domainOperations: Operation[] = [
  {
    name: "set_temperature",
    layer: "domain",
    description: "Set a heater temperature in Celsius.",
    target: { required: true, types: ["heater"] },
    params: { value: { type: "number", required: true, minimum: 0, maximum: 400 } },
    reversible: true,
  },
  {
    name: "set_level",
    layer: "domain",
    description: "Set a vessel fill level as a percentage.",
    target: { required: true, types: ["vessel"] },
    params: { value: { type: "number", required: true, minimum: 0, maximum: 100 } },
    reversible: true,
  },
  {
    name: "move",
    layer: "domain",
    description: "Move an object to a new position.",
    target: { required: true },
    params: {
      x: { type: "number", required: true },
      y: { type: "number", required: true },
    },
    reversible: true,
  },
  {
    name: "create",
    layer: "domain",
    description: "Create a heater or vessel in the lab scene.",
    target: { required: false },
    params: {
      id: { type: "string", required: true },
      type: { type: "string", required: true, enum: ["heater", "vessel"] },
      x: { type: "number", required: true },
      y: { type: "number", required: true },
    },
    reversible: true,
  },
];

function defaultObjects(): ScirObject[] {
  return [
    {
      id: "heater_01",
      type: "heater",
      properties: {
        temperature: 120,
        locked: false,
        position: [140, 170],
      },
    },
    {
      id: "heater_02",
      type: "heater",
      properties: {
        temperature: 80,
        locked: true,
        position: [370, 170],
      },
    },
    {
      id: "vessel_01",
      type: "vessel",
      properties: {
        level: 40,
        locked: false,
        position: [560, 170],
      },
    },
  ];
}

export class LabAdapter implements Adapter {
  readonly id = "lab";
  readonly domain = "lab-scene";
  private objects: ScirObject[];
  private selection: string[];

  constructor(seed?: { objects?: ScirObject[]; selection?: string[] }) {
    this.objects = cloneJson(seed?.objects ?? defaultObjects());
    this.selection = cloneJson(seed?.selection ?? ["heater_01"]);
  }

  catalog(): Operation[] {
    return [...coreOperations(), ...cloneJson(domainOperations)];
  }

  snapshot(query?: StateQuery): AdapterState {
    return {
      objects: cloneJson(this.objects.filter((object) => matchQuery(object, query))),
      selection: cloneJson(this.selection),
    };
  }

  fixtures() {
    return {
      validAction: {
        action: "set_temperature",
        target: "heater_01",
        params: { value: 150 },
      },
      invalidAction: {
        action: "set_temperature",
        target: "heater_02",
        params: { value: 150 },
      },
    };
  }

  check(action: Action, state: State): ValidationIssue[] {
    if (action.action !== "create") return [];
    const issues: ValidationIssue[] = [];
    if (typeof action.params.id === "string" && state.objects.some((object) => object.id === action.params.id)) {
      issues.push({
        code: "duplicate_target",
        message: `Object "${action.params.id}" already exists`,
        path: "id",
      });
    }
    return issues;
  }

  inverse(action: Action, before: State): Action | undefined {
    const target = action.target;
    const object = target ? before.objects.find((item) => item.id === target) : undefined;

    switch (action.action) {
      case "set_temperature":
        return object && target
          ? { action: "set_temperature", target, params: { value: object.properties.temperature ?? 0 } }
          : undefined;
      case "set_level":
        return object && target
          ? { action: "set_level", target, params: { value: object.properties.level ?? 0 } }
          : undefined;
      case "set_locked":
        return object && target
          ? { action: "set_locked", target, params: { value: object.properties.locked ?? false } }
          : undefined;
      case "move": {
        if (!object || !target) return undefined;
        const [x, y] = positionOf(object);
        return { action: "move", target, params: { x, y } };
      }
      case "create": {
        const id = action.params.id;
        return typeof id === "string" ? { action: "delete", target: id, params: {} } : undefined;
      }
      case "select": {
        const previous = before.selection[0];
        return previous ? { action: "select", target: previous, params: {} } : { action: "select", params: {} };
      }
      default:
        // delete cannot be rebuilt from a single lab action.
        return undefined;
    }
  }

  restore(state: AdapterState): void {
    this.objects = cloneJson(state.objects);
    this.selection = cloneJson(state.selection);
  }

  execute(action: Action, state: State) {
    void state;
    switch (action.action) {
      case "set_temperature":
        this.setProperty(action.target!, "temperature", action.params.value);
        break;
      case "set_level":
        this.setProperty(action.target!, "level", action.params.value);
        break;
      case "move":
        this.setProperty(action.target!, "position", [action.params.x, action.params.y]);
        break;
      case "set_locked":
        this.setProperty(action.target!, "locked", action.params.value);
        break;
      case "select":
        this.selection = action.target ? [action.target] : [];
        break;
      case "create":
        this.create(action);
        break;
      case "delete":
        this.delete(action.target!);
        break;
      default:
        throw new Error(`Adapter cannot execute "${action.action}"`);
    }
    return {};
  }

  private object(id: string): ScirObject {
    const found = this.objects.find((item) => item.id === id);
    if (!found) throw new Error(`Missing object ${id}`);
    return found;
  }

  private setProperty(id: string, key: string, value: unknown) {
    this.object(id).properties[key] = value as never;
  }

  private create(action: Action) {
    const id = action.params.id;
    const type = action.params.type;
    if (typeof id !== "string" || typeof type !== "string") {
      throw new Error("create requires id and type");
    }
    const x = action.params.x;
    const y = action.params.y;
    if (typeof x !== "number" || typeof y !== "number") {
      throw new Error("create requires x and y");
    }

    const properties =
      type === "heater"
        ? { temperature: 25, locked: false, position: [x, y] }
        : { level: 0, locked: false, position: [x, y] };

    this.objects.push({ id, type, properties });
    this.selection = [id];
  }

  private delete(id: string) {
    this.objects = this.objects.filter((object) => object.id !== id);
    this.selection = this.selection.filter((selected) => selected !== id);
  }
}

export function positionOf(object: ScirObject): [number, number] {
  return asNumberPair(object.properties.position) ?? [0, 0];
}
