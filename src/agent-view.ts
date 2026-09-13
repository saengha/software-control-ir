import type { Operation, ScirObject, State } from "./ir/types.js";

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

function formatObject(object: ScirObject): string {
  const parent = object.parent ? ` parent=${object.parent}` : "";
  const props = Object.entries(object.properties)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
  return `- ${object.id} (${object.type})${parent} ${props}`;
}

export function formatAgentView(state: State, catalog: Operation[]): string {
  const roots = state.objects.filter((object) => !object.parent);
  const children = state.objects.filter((object) => object.parent);
  const ordered = [
    ...roots.flatMap((root) => [root, ...children.filter((child) => child.parent === root.id)]),
    ...children.filter((child) => !roots.some((root) => root.id === child.parent)),
  ];

  const objects = ordered.map(formatObject).join("\n");

  const core = catalog.filter((operation) => operation.layer === "core");
  const domain = catalog.filter((operation) => operation.layer !== "core");

  const formatOps = (operations: Operation[]) =>
    operations
      .map((operation) => {
        const target = operation.target?.required
          ? `target:${operation.target.types?.join("|") ?? "any"}`
          : "target?:optional";
        const params = Object.entries(operation.params ?? {})
          .map(([name, spec]) => `${name}:${spec.type}`)
          .join(", ");
        return `- ${operation.name} ${target}${params ? ` params:{${params}}` : ""}`;
      })
      .join("\n");

  return [
    `revision ${state.revision}`,
    `selection ${formatValue(state.selection)}`,
    state.meta ? `meta ${formatValue(state.meta)}` : undefined,
    "objects",
    objects || "- (none)",
    "core operations",
    formatOps(core) || "- (none)",
    "domain operations",
    formatOps(domain) || "- (none)",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
