import { createHash } from "node:crypto";
import { boxOf, byZ, containsPoint } from "../../ir/geometry.js";
import { formatAgentView } from "../../agent-view.js";
import { selectRelevant } from "../../ir/query.js";
import type { Operation, State } from "../../ir/types.js";
import { VISION_FORBIDDEN_ACTIONS } from "./prompts.js";

export type VisionAppearance = "rect" | "oval" | "text";

export interface VisionPick {
  textIncludes?: string;
  fill?: string;
  appearance?: VisionAppearance;
}

export interface VisionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  appearance: VisionAppearance;
  fill: string;
  text: string;
}

export interface VisionObservation {
  kind: "vision";
  width: number;
  height: number;
  page: number;
  regions: VisionRegion[];
  raster: { format: "ppm"; width: number; height: number; sha256: string };
}

export interface StructuredObservation {
  kind: "structured";
  view: string;
  state: State;
}

export interface ObservationSize {
  chars: number;
  approxTokens: number;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appearanceOf(type: string): VisionAppearance | undefined {
  if (type === "ellipse") return "oval";
  if (type === "textbox") return "text";
  if (type === "rectangle") return "rect";
  return undefined;
}

function asFill(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function canvasOf(state: State): { width: number; height: number; page: number } {
  const slides = state.objects.filter((object) => object.type === "slide");
  const active = typeof state.meta?.activeSlide === "string" ? state.meta.activeSlide : slides[0]?.id;
  const page = Math.max(1, slides.findIndex((slide) => slide.id === active) + 1);
  const current = slides.find((slide) => slide.id === active);
  const width = typeof current?.properties.width === "number" ? current.properties.width : 960;
  const height = typeof current?.properties.height === "number" ? current.properties.height : 540;
  return { width, height, page };
}

export function observeStructured(state: State, catalog: Operation[]): StructuredObservation {
  const relevant = selectRelevant(state);
  return { kind: "structured", view: formatAgentView(relevant, catalog), state: relevant };
}

export function observeVision(state: State): VisionObservation {
  const relevant = selectRelevant(state);
  const canvas = canvasOf(state);
  const regions: VisionRegion[] = [];
  for (const object of byZ(relevant.objects)) {
    const appearance = appearanceOf(object.type);
    if (!appearance) continue;
    const box = boxOf(object);
    regions.push({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      appearance,
      fill: asFill(object.properties.fill),
      text: asText(object.properties.text),
    });
  }
  return {
    kind: "vision",
    width: canvas.width,
    height: canvas.height,
    page: canvas.page,
    regions,
    raster: rasterize(canvas.width, canvas.height, regions),
  };
}

export function observationSize(observation: StructuredObservation | VisionObservation): ObservationSize {
  const chars =
    observation.kind === "structured"
      ? observation.view.length + JSON.stringify(observation.state).length
      : JSON.stringify({
          kind: observation.kind,
          width: observation.width,
          height: observation.height,
          page: observation.page,
          regions: observation.regions,
          raster: observation.raster,
        }).length;
  return { chars, approxTokens: Math.ceil(chars / 4) };
}

function parseRgb(fill: string): [number, number, number] {
  const raw = fill.replace("#", "");
  const hex = raw.length === 3 ? raw.split("").map((ch) => `${ch}${ch}`).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [80, 80, 80];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function rasterize(
  worldWidth: number,
  worldHeight: number,
  regions: VisionRegion[],
): VisionObservation["raster"] {
  const width = 96;
  const height = Math.max(1, Math.round((96 * worldHeight) / Math.max(worldWidth, 1)));
  const pixels = Buffer.alloc(width * height * 3, 26);
  for (const region of regions) {
    const [r, g, b] = parseRgb(region.fill);
    const x0 = Math.max(0, Math.floor((region.x / worldWidth) * width));
    const y0 = Math.max(0, Math.floor((region.y / worldHeight) * height));
    const x1 = Math.min(width, Math.ceil(((region.x + region.width) / worldWidth) * width));
    const y1 = Math.min(height, Math.ceil(((region.y + region.height) / worldHeight) * height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * 3;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
      }
    }
  }
  const ppm = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
  return { format: "ppm", width, height, sha256: createHash("sha256").update(ppm).digest("hex") };
}

export function findRegion(observation: VisionObservation, pick: VisionPick): VisionRegion | undefined {
  return observation.regions.find((region) => {
    if (pick.appearance && region.appearance !== pick.appearance) return false;
    if (pick.fill && region.fill !== pick.fill.toLowerCase()) return false;
    if (pick.textIncludes && !region.text.includes(pick.textIncludes)) return false;
    return true;
  });
}

export function hitTarget(state: State, x: number, y: number): string | undefined {
  const shapes = byZ(selectRelevant(state).objects.filter((object) => appearanceOf(object.type))).reverse();
  return shapes.find((object) => containsPoint(boxOf(object), x, y))?.id;
}

export function visionJsonContainsSecrets(observation: VisionObservation): string[] {
  const blob = JSON.stringify(observation);
  const leaks: string[] = [];
  for (const secret of ["title_01", "accent_01", "logo_01", "body_02", "slide_01", "slide_02", "locked"]) {
    if (blob.includes(secret)) leaks.push(secret);
  }
  return leaks;
}

function asPick(value: unknown): VisionPick | undefined {
  if (!isPlain(value)) return undefined;
  const pick: VisionPick = {};
  if (typeof value.textIncludes === "string") pick.textIncludes = value.textIncludes;
  if (typeof value.fill === "string") pick.fill = value.fill;
  if (value.appearance === "rect" || value.appearance === "oval" || value.appearance === "text") {
    pick.appearance = value.appearance;
  }
  return pick;
}

/**
 * Structured scripts name object ids. Vision scripts pick visible regions; the
 * runner binds a click to whatever object occupies that box.
 */
export function bindPolicyAction(
  policy: "structured" | "vision",
  raw: unknown,
  state: State,
  vision: VisionObservation | undefined,
): unknown {
  if (!isPlain(raw)) return raw;
  if (policy === "structured") {
    if ("pick" in raw) throw new Error("structured policy cannot pick visually");
    return raw;
  }
  if ("target" in raw) throw new Error("vision policy cannot name object ids");
  if ("batch" in raw) throw new Error("vision policy cannot open a transaction");
  if (typeof raw.action === "string" && VISION_FORBIDDEN_ACTIONS.has(raw.action)) {
    throw new Error(`vision policy cannot call ${raw.action}`);
  }

  const next: Record<string, unknown> = { ...raw };
  const pick = asPick(raw.pick);
  delete next.pick;
  if (pick && vision) {
    const region = findRegion(vision, pick);
    if (region) {
      const id = hitTarget(state, region.x + region.width / 2, region.y + region.height / 2);
      if (id) next.target = id;
    }
  }
  return next;
}
