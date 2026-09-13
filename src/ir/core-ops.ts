import type { Operation } from "./types.js";
import { cloneJson } from "./normalize.js";

export const CORE_OPERATIONS: Operation[] = [
  {
    name: "select",
    layer: "core",
    description: "Select an object. Pass no target to clear selection.",
    target: { required: false },
    appliesWhenLocked: true,
    reversible: true,
  },
  {
    name: "set_locked",
    layer: "core",
    description: "Lock or unlock an object.",
    target: { required: true },
    params: { value: { type: "boolean", required: true } },
    appliesWhenLocked: true,
    reversible: true,
  },
  {
    name: "delete",
    layer: "core",
    description: "Delete an object. Rejected when the object still has children.",
    target: { required: true },
    reversible: true,
  },
];

export function coreOperations(): Operation[] {
  return cloneJson(CORE_OPERATIONS);
}
