import type { AdapterState, ScirObject } from "../../ir/types.js";
import { boxOf, byZ } from "../../ir/geometry.js";
import { CONTRAST_BG, WCAG_AA_RATIO } from "../../fixtures/contrast.js";

export interface SlideRaster {
  width: number;
  height: number;
  pixels: Buffer;
}

export interface ContrastGrade {
  ratio: number;
  passes: boolean;
  blue: boolean;
  darker: boolean;
  background: [number, number, number];
  foreground: [number, number, number];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  const hi = Math.max(left, right);
  const lo = Math.min(left, right);
  return (hi + 0.05) / (lo + 0.05);
}

export function parseRgb(fill: string): [number, number, number] | undefined {
  const raw = fill.trim().toLowerCase();
  if (!raw || raw === "none" || raw === "transparent") return undefined;
  const hex = raw.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((ch) => `${ch}${ch}`).join("") : hex;
  if (!/^[0-9a-f]{6}$/.test(full)) return undefined;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function isBlue(rgb: [number, number, number]): boolean {
  return rgb[2] > rgb[0] && rgb[2] >= rgb[1];
}

function canvasOf(state: AdapterState): { width: number; height: number; fill: string } {
  const slides = state.objects.filter((object) => object.type === "slide");
  const active = typeof state.meta?.activeSlide === "string" ? state.meta.activeSlide : slides[0]?.id;
  const current = slides.find((slide) => slide.id === active);
  return {
    width: typeof current?.properties.width === "number" ? current.properties.width : 960,
    height: typeof current?.properties.height === "number" ? current.properties.height : 540,
    fill: typeof current?.properties.fill === "string" ? current.properties.fill : "#ffffff",
  };
}

function paintRect(
  pixels: Buffer,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
) {
  const left = Math.max(0, Math.min(width, Math.floor(x0)));
  const top = Math.max(0, Math.min(height, Math.floor(y0)));
  const right = Math.max(0, Math.min(width, Math.ceil(x1)));
  const bottom = Math.max(0, Math.min(height, Math.ceil(y1)));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * width + x) * 3;
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
    }
  }
}

function mapBox(
  box: { x: number; y: number; width: number; height: number },
  world: { width: number; height: number },
  raster: { width: number; height: number },
) {
  return {
    x0: (box.x / world.width) * raster.width,
    y0: (box.y / world.height) * raster.height,
    x1: ((box.x + box.width) / world.width) * raster.width,
    y1: ((box.y + box.height) / world.height) * raster.height,
  };
}

function textSampleObject(state: AdapterState): ScirObject | undefined {
  const active = typeof state.meta?.activeSlide === "string" ? state.meta.activeSlide : undefined;
  return state.objects.find(
    (object) =>
      object.type === "textbox" &&
      (active ? object.parent === active : true) &&
      typeof object.properties.text === "string" &&
      object.properties.text.length > 0,
  );
}

/** In-memory canvas export: slide fill, shape fills, then glyph color as an inset. */
export function renderSlideRaster(state: AdapterState, rasterWidth = 160): SlideRaster {
  const world = canvasOf(state);
  const width = rasterWidth;
  const height = Math.max(1, Math.round((rasterWidth * world.height) / Math.max(world.width, 1)));
  const bg = parseRgb(world.fill) ?? [255, 255, 255];
  const pixels = Buffer.alloc(width * height * 3);
  paintRect(pixels, width, height, 0, 0, width, height, bg);

  const shapes = byZ(
    state.objects.filter((object) => object.type === "rectangle" || object.type === "ellipse" || object.type === "textbox"),
  );
  for (const object of shapes) {
    const mapped = mapBox(boxOf(object), world, { width, height });
    const fill = parseRgb(typeof object.properties.fill === "string" ? object.properties.fill : "");
    if (fill) paintRect(pixels, width, height, mapped.x0, mapped.y0, mapped.x1, mapped.y1, fill);
    const text = typeof object.properties.text === "string" ? object.properties.text : "";
    const textColor = parseRgb(
      typeof object.properties.textColor === "string" ? object.properties.textColor : "",
    );
    if (text && textColor) {
      const insetX = (mapped.x1 - mapped.x0) * 0.12;
      const insetY = (mapped.y1 - mapped.y0) * 0.18;
      paintRect(
        pixels,
        width,
        height,
        mapped.x0 + insetX,
        mapped.y0 + insetY,
        mapped.x1 - insetX,
        mapped.y1 - insetY,
        textColor,
      );
    }
  }

  return { width, height, pixels };
}

export function encodePpm(raster: SlideRaster): Buffer {
  return Buffer.concat([Buffer.from(`P6\n${raster.width} ${raster.height}\n255\n`), raster.pixels]);
}

export function samplePixel(raster: SlideRaster, x: number, y: number): [number, number, number] {
  const px = Math.max(0, Math.min(raster.width - 1, Math.floor(x)));
  const py = Math.max(0, Math.min(raster.height - 1, Math.floor(y)));
  const i = (py * raster.width + px) * 3;
  return [raster.pixels[i] ?? 0, raster.pixels[i + 1] ?? 0, raster.pixels[i + 2] ?? 0];
}

function sampleForeground(state: AdapterState, raster: SlideRaster): [number, number, number] {
  const world = canvasOf(state);
  const title = textSampleObject(state);
  if (!title) return samplePixel(raster, raster.width / 2, raster.height / 2);
  const mapped = mapBox(boxOf(title), world, raster);
  return samplePixel(raster, (mapped.x0 + mapped.x1) / 2, (mapped.y0 + mapped.y1) / 2);
}

/**
 * Contrast from a rendered raster only. Policy (structured vs vision) is not an input.
 * Call this from both conditions; they must agree on the same image.
 */
export function gradeRenderedContrast(state: AdapterState, raster: SlideRaster): ContrastGrade {
  const background = samplePixel(raster, 2, 2);
  const foreground = sampleForeground(state, raster);
  const ratio = contrastRatio(foreground, background);
  const start = parseRgb(CONTRAST_BG) ?? [244, 247, 251];
  return {
    ratio,
    passes: ratio >= WCAG_AA_RATIO,
    blue: isBlue(background),
    darker: relativeLuminance(background) < relativeLuminance(start) - 0.02,
    background,
    foreground,
  };
}

export function formatContrastRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
