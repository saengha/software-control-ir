import type { Operation, State } from "./ir/types.js";

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

export function formatAgentView(state: State, catalog: Operation[]): string {
  const objects = state.objects
    .map((object) => {
      const props = Object.entries(object.properties)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(" ");
      return `- ${object.id} (${object.type}) ${props}`;
    })
    .join("\n");

  const operations = catalog
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
    "objects",
    objects || "- (none)",
    "operations",
    operations || "- (none)",
  ].join("\n");
}
