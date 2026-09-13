import type { ScirObject } from "./types.js";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function boxOf(object: ScirObject): Box {
  const position = object.properties.position;
  if (Array.isArray(position) && typeof position[0] === "number" && typeof position[1] === "number") {
    return { x: position[0], y: position[1], width: 140, height: 96 };
  }
  return {
    x: num(object.properties.x),
    y: num(object.properties.y),
    width: num(object.properties.width, 120),
    height: num(object.properties.height, 80),
  };
}

export function containsPoint(box: Box, x: number, y: number): boolean {
  return x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
}

export function resizeHandle(box: Box): Box {
  return { x: box.x + box.width - 10, y: box.y + box.height - 10, width: 10, height: 10 };
}

export function zOf(object: ScirObject): number {
  return typeof object.properties.z === "number" ? object.properties.z : 0;
}

export function byZ(objects: ScirObject[]): ScirObject[] {
  return [...objects].sort((left, right) => zOf(left) - zOf(right));
}
