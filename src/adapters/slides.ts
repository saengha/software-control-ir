import type {
  Action,
  AdapterState,
  Capabilities,
  Json,
  Operation,
  ScirObject,
  State,
  StateQuery,
  ValidationIssue,
} from "../ir/types.js";
import { coreOperations } from "../ir/core-ops.js";
import { boxOf, zOf } from "../ir/geometry.js";
import { cloneJson } from "../ir/normalize.js";
import { descendantsOf, matchQuery } from "../ir/query.js";
import type { Adapter } from "../runtime/adapter.js";

const SHAPE_KINDS = ["rectangle", "ellipse", "textbox"] as const;
const ALIGN = ["left", "center", "right", "top", "middle", "bottom"] as const;
const MOVABLE = [...SHAPE_KINDS, "group"];

type ShapeKind = (typeof SHAPE_KINDS)[number];
type AlignEdge = (typeof ALIGN)[number];

const domainOperations: Operation[] = [
  {
    name: "move",
    layer: "domain",
    description: "Move a shape or group to a new top-left corner. Moving a group shifts its members.",
    target: { required: true, types: MOVABLE },
    params: {
      x: { type: "number", required: true, minimum: 0 },
      y: { type: "number", required: true, minimum: 0 },
    },
    reversible: true,
  },
  {
    name: "resize",
    layer: "domain",
    description: "Change a shape's bounding box. PowerPoint-style, not a mesh scale.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: {
      width: { type: "number", required: true, minimum: 8 },
      height: { type: "number", required: true, minimum: 8 },
    },
    reversible: true,
  },
  {
    name: "create_shape",
    layer: "domain",
    description: "Create a rectangle, ellipse, or text box on a slide.",
    target: { required: false },
    params: {
      kind: { type: "string", required: true, enum: [...SHAPE_KINDS] },
      x: { type: "number", required: true, minimum: 0 },
      y: { type: "number", required: true, minimum: 0 },
      width: { type: "number", required: true, minimum: 8 },
      height: { type: "number", required: true, minimum: 8 },
      id: { type: "string" },
      text: { type: "string" },
      parent: { type: "string" },
    },
    reversible: true,
  },
  {
    name: "set_fill",
    layer: "domain",
    description: "Set a shape fill color as a hex string.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: { value: { type: "string", required: true } },
    reversible: true,
  },
  {
    name: "set_text",
    layer: "domain",
    description: "Set text on a shape.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: { value: { type: "string", required: true } },
    reversible: true,
  },
  {
    name: "align",
    layer: "domain",
    description: "Align a shape to its parent slide.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: { edge: { type: "string", required: true, enum: [...ALIGN] } },
    reversible: true,
  },
  {
    name: "set_active_slide",
    layer: "domain",
    description: "Change which slide is current. Relevant state follows this.",
    target: { required: true, types: ["slide"] },
    appliesWhenLocked: true,
    reversible: true,
  },
  {
    name: "duplicate",
    layer: "domain",
    description: "Copy a shape onto the same slide, offset from the original.",
    target: { required: true, types: [...SHAPE_KINDS] },
    appliesWhenLocked: true,
    reversible: true,
  },
  {
    name: "bring_to_front",
    layer: "domain",
    description: "Raise a shape above siblings. This is slide z-order, not a 3D transform.",
    target: { required: true, types: [...SHAPE_KINDS] },
    appliesWhenLocked: true,
    reversible: true,
  },
  {
    name: "send_to_back",
    layer: "domain",
    description: "Lower a shape below siblings.",
    target: { required: true, types: [...SHAPE_KINDS] },
    appliesWhenLocked: true,
    reversible: true,
  },
  {
    name: "group",
    layer: "domain",
    description: "Group two or more shapes that share one slide.",
    target: { required: false },
    params: {
      ids: { type: "array", required: true },
      id: { type: "string" },
    },
    reversible: true,
  },
  {
    name: "ungroup",
    layer: "domain",
    description: "Dissolve a group and return its members to the slide.",
    target: { required: true, types: ["group"] },
    reversible: true,
  },
];

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === "string" && (SHAPE_KINDS as readonly string[]).includes(value);
}

function isAlign(value: unknown): value is AlignEdge {
  return typeof value === "string" && (ALIGN as readonly string[]).includes(value);
}

function hexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function idList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item): item is string => typeof item === "string")) return undefined;
  return value;
}

function num(value: Json | undefined, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function shape(
  id: string,
  kind: ShapeKind,
  parent: string,
  props: Record<string, string | number | boolean>,
): ScirObject {
  return {
    id,
    type: kind,
    parent,
    properties: {
      locked: false,
      fill: "#d9efe3",
      text: "",
      x: 80,
      y: 80,
      width: 160,
      height: 90,
      z: 0,
      ...props,
    },
  };
}

function slide(id: string, title: string): ScirObject {
  return { id, type: "slide", properties: { title, width: 960, height: 540, locked: false } };
}

interface Seed {
  objects: ScirObject[];
  selection: string[];
  meta: { activeSlide: string };
}

function defaultDocument(): Seed {
  return {
    meta: { activeSlide: "slide_01" },
    selection: ["title_01"],
    objects: [
      slide("slide_01", "Title"),
      slide("slide_02", "Notes"),
      shape("title_01", "textbox", "slide_01", {
        x: 80,
        y: 70,
        width: 800,
        height: 90,
        text: "Quarterly Review",
        fill: "#0f1a14",
        z: 1,
      }),
      shape("accent_01", "rectangle", "slide_01", {
        x: 80,
        y: 180,
        width: 240,
        height: 16,
        fill: "#e6a23c",
        z: 2,
      }),
      shape("logo_01", "ellipse", "slide_01", {
        x: 820,
        y: 430,
        width: 60,
        height: 60,
        fill: "#8fd0c4",
        locked: true,
        z: 3,
      }),
      shape("body_02", "textbox", "slide_02", {
        x: 80,
        y: 80,
        width: 500,
        height: 120,
        text: "Second slide is hidden from relevant state until activated.",
        fill: "#0f1a14",
        z: 1,
      }),
    ],
  };
}

function blankDocument(): Seed {
  return {
    meta: { activeSlide: "slide_01" },
    selection: ["slide_01"],
    objects: [slide("slide_01", "Blank")],
  };
}

/** A deck large enough that full state and relevant state are worth comparing. */
function deckDocument(slides = 8, perSlide = 5): Seed {
  const objects: ScirObject[] = [];
  for (let s = 1; s <= slides; s += 1) {
    const slideId = `slide_${String(s).padStart(2, "0")}`;
    objects.push(slide(slideId, `Section ${s}`));
    for (let i = 1; i <= perSlide; i += 1) {
      const kind: ShapeKind = i === 1 ? "textbox" : i % 2 === 0 ? "rectangle" : "ellipse";
      objects.push(
        shape(`${slideId}_shape_${i}`, kind, slideId, {
          x: 60 + ((i - 1) % 3) * 300,
          y: 70 + Math.floor((i - 1) / 3) * 200,
          width: 260,
          height: 140,
          text: kind === "textbox" ? `Section ${s} heading` : "",
          z: i,
        }),
      );
    }
  }
  return { meta: { activeSlide: "slide_01" }, selection: ["slide_01"], objects };
}

function contrastDocument(): Seed {
  return {
    meta: { activeSlide: "slide_01" },
    selection: ["slide_01"],
    objects: [
      slide("slide_01", "Contrast"),
      shape("bg_01", "rectangle", "slide_01", {
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        fill: "#f4f7fb",
        z: 0,
      }),
      shape("title_01", "textbox", "slide_01", {
        x: 80,
        y: 70,
        width: 800,
        height: 90,
        text: "Sample heading",
        fill: "none",
        textColor: "#ffffff",
        z: 1,
      }),
    ],
  };
}

export type SlidesPreset = "default" | "blank" | "deck" | "contrast";

export class SlidesAdapter implements Adapter {
  readonly id = "slides";
  readonly domain = "presentation";
  private objects: ScirObject[];
  private selection: string[];
  private meta: { activeSlide: string };

  constructor(options?: { preset?: SlidesPreset }) {
    const seed =
      options?.preset === "blank"
        ? blankDocument()
        : options?.preset === "deck"
          ? deckDocument()
          : options?.preset === "contrast"
            ? contrastDocument()
            : defaultDocument();
    this.objects = cloneJson(seed.objects);
    this.selection = cloneJson(seed.selection);
    this.meta = cloneJson(seed.meta);
  }

  catalog(): Operation[] {
    return [...coreOperations(), ...cloneJson(domainOperations)];
  }

  capabilities(): Partial<Capabilities> {
    // The slide model always supports nesting, even in a document that has none yet.
    return { hierarchy: true };
  }

  snapshot(query?: StateQuery): AdapterState {
    return {
      objects: cloneJson(this.objects.filter((object) => matchQuery(object, query))),
      selection: cloneJson(this.selection),
      meta: cloneJson(this.meta),
    };
  }

  fixtures() {
    return {
      validAction: {
        action: "create_shape",
        params: { kind: "rectangle", x: 300, y: 240, width: 180, height: 100 },
      },
      invalidAction: {
        action: "set_fill",
        target: "logo_01",
        params: { value: "#ff0000" },
      },
    };
  }

  check(action: Action, state: State): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (action.action === "create_shape") {
      const parent = typeof action.params.parent === "string" ? action.params.parent : this.meta.activeSlide;
      const parentObject = state.objects.find((object) => object.id === parent);
      if (!parentObject || parentObject.type !== "slide") {
        issues.push({ code: "unknown_target", message: `Slide "${parent}" does not exist`, path: "parent" });
      }
      if (typeof action.params.id === "string" && state.objects.some((object) => object.id === action.params.id)) {
        issues.push({
          code: "duplicate_target",
          message: `Object "${action.params.id}" already exists`,
          path: "id",
        });
      }
    }

    if (action.action === "duplicate" && action.target) {
      const copyId = `${action.target}_copy`;
      if (state.objects.some((object) => object.id === copyId)) {
        issues.push({ code: "duplicate_target", message: `Object "${copyId}" already exists`, path: "target" });
      }
    }

    if (action.action === "set_fill" && !hexColor(action.params.value)) {
      issues.push({ code: "invalid_params", message: "Fill must be a hex color like #e6a23c", path: "value" });
    }

    if (action.action === "group") {
      issues.push(...this.checkGroup(action, state));
    }

    return issues;
  }

  private checkGroup(action: Action, state: State): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const ids = idList(action.params.ids);
    if (!ids) {
      return [{ code: "invalid_params", message: "group requires an array of object ids", path: "ids" }];
    }
    if (ids.length < 2) {
      issues.push({ code: "invalid_params", message: "group needs at least two shapes", path: "ids" });
    }

    const members = ids.map((id) => state.objects.find((object) => object.id === id));
    const parents = new Set<string | undefined>();
    ids.forEach((id, index) => {
      const member = members[index];
      if (!member) {
        issues.push({ code: "unknown_target", message: `Object "${id}" does not exist`, path: "ids" });
        return;
      }
      if (!(SHAPE_KINDS as readonly string[]).includes(member.type)) {
        issues.push({
          code: "type_mismatch",
          message: `Object "${id}" is a ${member.type}, not a shape`,
          path: "ids",
        });
      }
      if (member.properties.locked === true) {
        issues.push({ code: "locked", message: `Object "${id}" is locked`, path: "ids" });
      }
      parents.add(member.parent);
    });

    if (parents.size > 1) {
      issues.push({ code: "invalid_params", message: "group members must share one parent", path: "ids" });
    }

    const groupId = typeof action.params.id === "string" ? action.params.id : undefined;
    if (groupId && state.objects.some((object) => object.id === groupId)) {
      issues.push({ code: "duplicate_target", message: `Object "${groupId}" already exists`, path: "id" });
    }

    return issues;
  }

  inverse(action: Action, before: State): Action | undefined {
    const target = action.target;
    const object = target ? before.objects.find((item) => item.id === target) : undefined;

    switch (action.action) {
      case "set_text":
      case "set_fill":
      case "set_locked": {
        if (!object || !target) return undefined;
        const key = action.action === "set_text" ? "text" : action.action === "set_fill" ? "fill" : "locked";
        return { action: action.action, target, params: { value: object.properties[key] ?? null } };
      }
      case "move":
      case "align": {
        if (!object || !target) return undefined;
        const box = boxOf(object);
        return { action: "move", target, params: { x: box.x, y: box.y } };
      }
      case "resize": {
        if (!object || !target) return undefined;
        const box = boxOf(object);
        return { action: "resize", target, params: { width: box.width, height: box.height } };
      }
      case "create_shape": {
        const id = action.params.id;
        return typeof id === "string" ? { action: "delete", target: id, params: {} } : undefined;
      }
      case "duplicate":
        return target ? { action: "delete", target: `${target}_copy`, params: {} } : undefined;
      case "select": {
        const previous = before.selection[0];
        return previous ? { action: "select", target: previous, params: {} } : { action: "select", params: {} };
      }
      case "set_active_slide": {
        const active = before.meta?.activeSlide;
        return typeof active === "string"
          ? { action: "set_active_slide", target: active, params: {} }
          : undefined;
      }
      default:
        // delete, group, ungroup, and z-order changes have no single inverse action here.
        return undefined;
    }
  }

  restore(state: AdapterState): void {
    this.objects = cloneJson(state.objects);
    this.selection = cloneJson(state.selection);
    const active = state.meta?.activeSlide;
    this.meta = { activeSlide: typeof active === "string" ? active : "slide_01" };
  }

  execute(action: Action, state: State) {
    switch (action.action) {
      case "select":
        this.selection = action.target ? [action.target] : [];
        break;
      case "set_locked":
        this.setProperty(action.target!, "locked", action.params.value);
        break;
      case "delete":
        this.objects = this.objects.filter((object) => object.id !== action.target);
        this.selection = this.selection.filter((id) => id !== action.target);
        break;
      case "move":
        this.move(action.target!, num(action.params.x), num(action.params.y), state);
        break;
      case "resize":
        this.setProperty(action.target!, "width", action.params.width);
        this.setProperty(action.target!, "height", action.params.height);
        break;
      case "create_shape":
        this.createShape(action);
        break;
      case "set_fill":
        this.setProperty(action.target!, "fill", action.params.value);
        break;
      case "set_text":
        this.setProperty(action.target!, "text", action.params.value);
        break;
      case "align":
        this.align(action.target!, action.params.edge);
        break;
      case "set_active_slide":
        this.meta.activeSlide = action.target!;
        this.selection = [action.target!];
        break;
      case "duplicate":
        this.duplicate(action.target!);
        break;
      case "bring_to_front":
        this.setZ(action.target!, this.maxZ(this.object(action.target!).parent) + 1);
        break;
      case "send_to_back":
        this.setZ(action.target!, this.minZ(this.object(action.target!).parent) - 1);
        break;
      case "group":
        this.group(action);
        break;
      case "ungroup":
        this.ungroup(action.target!, state);
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

  private move(id: string, x: number, y: number, state: State) {
    const object = this.object(id);
    const box = boxOf(object);
    object.properties.x = x;
    object.properties.y = y;
    if (object.type !== "group") return;

    const dx = x - box.x;
    const dy = y - box.y;
    for (const descendant of descendantsOf(state, id)) {
      const member = this.object(descendant.id);
      member.properties.x = num(member.properties.x) + dx;
      member.properties.y = num(member.properties.y) + dy;
    }
  }

  private createShape(action: Action) {
    const kind = action.params.kind;
    if (!isShapeKind(kind)) throw new Error("invalid kind");
    const parent = typeof action.params.parent === "string" ? action.params.parent : this.meta.activeSlide;
    const id =
      typeof action.params.id === "string"
        ? action.params.id
        : `${kind.slice(0, 4)}_${this.objects.length + 1}`;
    const next = shape(id, kind, parent, {
      x: num(action.params.x),
      y: num(action.params.y),
      width: num(action.params.width, 160),
      height: num(action.params.height, 90),
      text: typeof action.params.text === "string" ? action.params.text : kind === "textbox" ? "Text" : "",
      fill: kind === "textbox" ? "#0f1a14" : "#4e7f74",
      z: this.maxZ(parent) + 1,
    });
    this.objects.push(next);
    this.selection = [id];
  }

  private siblings(parent: string | undefined): ScirObject[] {
    return this.objects.filter((object) => object.parent === parent);
  }

  private maxZ(parent: string | undefined): number {
    return this.siblings(parent).reduce((max, object) => Math.max(max, zOf(object)), 0);
  }

  private minZ(parent: string | undefined): number {
    const siblings = this.siblings(parent);
    if (siblings.length === 0) return 0;
    return siblings.reduce((min, object) => Math.min(min, zOf(object)), zOf(siblings[0]!));
  }

  private setZ(id: string, z: number) {
    this.object(id).properties.z = z;
  }

  private duplicate(id: string) {
    const source = this.object(id);
    const copyId = `${id}_copy`;
    if (this.objects.some((object) => object.id === copyId)) {
      throw new Error(`Object "${copyId}" already exists`);
    }
    const copy = cloneJson(source);
    copy.id = copyId;
    copy.properties.x = num(source.properties.x) + 24;
    copy.properties.y = num(source.properties.y) + 24;
    copy.properties.z = this.maxZ(source.parent) + 1;
    copy.properties.locked = false;
    this.objects.push(copy);
    this.selection = [copyId];
  }

  private group(action: Action) {
    const ids = idList(action.params.ids);
    if (!ids || ids.length < 2) throw new Error("group requires at least two ids");
    const members = ids.map((id) => this.object(id));
    const parent = members[0]!.parent;
    if (!parent) throw new Error("group members need a parent slide");

    const groupId =
      typeof action.params.id === "string" ? action.params.id : `group_${this.objects.length + 1}`;
    const boxes = members.map((member) => boxOf(member));
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));

    this.objects.push({
      id: groupId,
      type: "group",
      parent,
      properties: {
        locked: false,
        x,
        y,
        width: right - x,
        height: bottom - y,
        z: this.maxZ(parent) + 1,
      },
    });
    for (const member of members) {
      member.parent = groupId;
    }
    this.selection = [groupId];
  }

  private ungroup(id: string, state: State) {
    const group = this.object(id);
    const parent = group.parent;
    const members = descendantsOf(state, id).filter((object) => object.parent === id);
    for (const member of members) {
      const live = this.object(member.id);
      if (parent) live.parent = parent;
      else delete live.parent;
    }
    this.objects = this.objects.filter((object) => object.id !== id);
    this.selection = members.map((member) => member.id);
  }

  private align(id: string, edge: unknown) {
    if (!isAlign(edge)) throw new Error("invalid edge");
    const object = this.object(id);
    const parent = this.objects.find((item) => item.id === object.parent);
    if (!parent) throw new Error("shape has no slide");
    const slideBox = boxOf(parent);
    const box = boxOf(object);
    let x = box.x;
    let y = box.y;
    if (edge === "left") x = 40;
    if (edge === "center") x = Math.round((slideBox.width - box.width) / 2);
    if (edge === "right") x = slideBox.width - box.width - 40;
    if (edge === "top") y = 40;
    if (edge === "middle") y = Math.round((slideBox.height - box.height) / 2);
    if (edge === "bottom") y = slideBox.height - box.height - 40;
    object.properties.x = x;
    object.properties.y = y;
  }
}
