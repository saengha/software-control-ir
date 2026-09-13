import { cloneJson } from "./normalize.js";
import type { Action, ActionFocus, Effect, Json, ObjectId, ScirObject, State } from "./types.js";

function indexObjects(objects: ScirObject[]): Map<ObjectId, ScirObject> {
  return new Map(objects.map((object) => [object.id, object]));
}

function objectById(state: State, id: ObjectId | undefined): ScirObject | undefined {
  if (!id) return undefined;
  return state.objects.find((object) => object.id === id);
}

export function diffStates(before: State, after: State): Effect[] {
  const effects: Effect[] = [];
  const beforeMap = indexObjects(before.objects);
  const afterMap = indexObjects(after.objects);

  for (const [id, previous] of beforeMap) {
    const next = afterMap.get(id);
    if (!next) {
      effects.push({ kind: "delete", target: id, from: cloneJson(previous) as unknown as Json, to: null });
      continue;
    }
    if (previous.type !== next.type) {
      effects.push({
        kind: "update",
        target: id,
        path: "type",
        from: previous.type,
        to: next.type,
      });
    }
    if (previous.parent !== next.parent) {
      effects.push({
        kind: "update",
        target: id,
        path: "parent",
        from: previous.parent ?? null,
        to: next.parent ?? null,
      });
    }
    const keys = new Set([...Object.keys(previous.properties), ...Object.keys(next.properties)]);
    for (const key of keys) {
      const from = previous.properties[key];
      const to = next.properties[key];
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        effects.push({
          kind: "update",
          target: id,
          path: `properties.${key}`,
          from: from ?? null,
          to: to ?? null,
        });
      }
    }
  }

  for (const [id, next] of afterMap) {
    if (!beforeMap.has(id)) {
      effects.push({ kind: "create", target: id, to: cloneJson(next) as unknown as Json });
    }
  }

  if (JSON.stringify(before.selection) !== JSON.stringify(after.selection)) {
    const target = after.selection[0] ?? before.selection[0] ?? "";
    effects.push({
      kind: "select",
      target,
      from: before.selection,
      to: after.selection,
    });
  }

  return effects;
}

export function focusFor(action: Action, before: State, after: State): ActionFocus | undefined {
  const id = action.target;
  if (!id) {
    const created = after.objects.find((object) => !before.objects.some((item) => item.id === object.id));
    if (!created) return undefined;
    return { after: created };
  }
  const focus: ActionFocus = {};
  const previous = objectById(before, id);
  const next = objectById(after, id);
  if (previous) focus.before = previous;
  if (next) focus.after = next;
  if (!focus.before && !focus.after) return undefined;
  return focus;
}
