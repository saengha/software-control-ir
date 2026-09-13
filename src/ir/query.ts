import type { ObjectId, ScirObject, State, StateQuery } from "./types.js";

export function matchQuery(object: ScirObject, query?: StateQuery): boolean {
  if (!query) return true;
  if (query.ids && !query.ids.includes(object.id)) return false;
  if (query.types && !query.types.includes(object.type)) return false;
  if (query.parent && object.parent !== query.parent && object.id !== query.parent) return false;
  return true;
}

export function childrenOf(state: State, parentId: ObjectId): ScirObject[] {
  return state.objects.filter((object) => object.parent === parentId);
}

/** Transitive children, so a slide still owns shapes nested inside a group. */
export function descendantsOf(state: State, rootId: ObjectId): ScirObject[] {
  const found: ScirObject[] = [];
  const frontier = [rootId];
  while (frontier.length > 0) {
    const parentId = frontier.pop()!;
    for (const child of childrenOf(state, parentId)) {
      if (found.some((item) => item.id === child.id)) continue;
      found.push(child);
      frontier.push(child.id);
    }
  }
  return found;
}

export function ancestorsOf(state: State, id: ObjectId): ScirObject[] {
  const chain: ScirObject[] = [];
  let current = state.objects.find((object) => object.id === id);
  while (current?.parent) {
    const parent = state.objects.find((object) => object.id === current!.parent);
    if (!parent || chain.some((item) => item.id === parent.id)) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** The container an agent is currently working inside, e.g. the active slide. */
export function relevantFocusId(state: State): ObjectId | undefined {
  const selectedId = state.selection[0];
  if (selectedId) {
    const selected = state.objects.find((object) => object.id === selectedId);
    if (selected) {
      const root = [selected, ...ancestorsOf(state, selectedId)].reverse()[0];
      if (root) return root.id;
    }
  }
  const active = state.meta?.activeSlide;
  return typeof active === "string" ? active : undefined;
}

/** Minimum state for the current container. Falls back to full state. */
export function selectRelevant(state: State): State {
  const focusId = relevantFocusId(state);
  if (!focusId) return state;
  const focus = state.objects.find((object) => object.id === focusId);
  if (!focus) return state;
  return {
    ...state,
    objects: [focus, ...descendantsOf(state, focusId)],
  };
}
