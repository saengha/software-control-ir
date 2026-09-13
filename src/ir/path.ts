export function getPath(root: unknown, path: string): unknown {
  if (path === "") return root;
  const parts = path.split(".");
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isLocked(object: { properties: Record<string, unknown> }): boolean {
  return object.properties.locked === true;
}
