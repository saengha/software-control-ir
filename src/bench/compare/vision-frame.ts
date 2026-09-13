import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodePngRgb, encodePngRgb, type RgbRaster } from "../../adapters/impress/png.js";
import type { Adapter } from "../../runtime/adapter.js";
import type { State } from "../../ir/types.js";
import { renderSlideRaster } from "./contrast.js";
import { visibleChrome, type UiChrome } from "./ui.js";

export const VISION_PAD_TOP = 48;
export const VISION_PAD_BOTTOM = 40;

export interface VisionFrame {
  png: Buffer;
  width: number;
  height: number;
  slideWidth: number;
  slideHeight: number;
  worldWidth: number;
  worldHeight: number;
  chrome: ReturnType<typeof visibleChrome>;
}

function canvasOf(state: State): { width: number; height: number } {
  const active = typeof state.meta?.activeSlide === "string" ? state.meta.activeSlide : undefined;
  const slide = state.objects.find((object) => object.id === active && object.type === "slide");
  return {
    width: typeof slide?.properties.width === "number" ? slide.properties.width : 960,
    height: typeof slide?.properties.height === "number" ? slide.properties.height : 540,
  };
}

function paint(pixels: Buffer, width: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(width, Math.ceil(x1));
  const height = Math.floor(pixels.length / (width * 3));
  const bottom = Math.min(height, Math.ceil(y1));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * width + x) * 3;
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
    }
  }
}

function padChrome(slide: RgbRaster): RgbRaster {
  const width = slide.width;
  const height = slide.height + VISION_PAD_TOP + VISION_PAD_BOTTOM;
  const pixels = Buffer.alloc(width * height * 3, 36);
  for (let y = 0; y < slide.height; y += 1) {
    slide.pixels.copy(
      pixels,
      ((y + VISION_PAD_TOP) * width) * 3,
      y * width * 3,
      (y + 1) * width * 3,
    );
  }
  paint(pixels, width, 8, 8, 72, 40, [70, 70, 78]);
  paint(pixels, width, 88, 8, 152, 40, [70, 70, 78]);
  paint(pixels, width, 168, 8, 232, 40, [70, 70, 78]);
  paint(pixels, width, 8, height - 32, 72, height - 8, [58, 58, 66]);
  paint(pixels, width, 88, height - 32, 152, height - 8, [58, 58, 66]);
  return { width, height, pixels };
}

function slideRaster(adapter: Adapter, state: State): RgbRaster {
  const host = adapter as Adapter & { exportPng?: (filePath: string) => void };
  if (typeof host.exportPng === "function") {
    const dir = mkdtempSync(path.join(tmpdir(), "scir-shot-"));
    const dest = path.join(dir, "slide.png");
    try {
      host.exportPng(dest);
      return decodePngRgb(readFileSync(dest));
    } catch {
      return renderSlideRaster(state, 640);
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // temp dir
      }
    }
  }
  return renderSlideRaster(state, 640);
}

export function captureVisionFrame(adapter: Adapter, state: State, chrome: UiChrome): VisionFrame {
  const world = canvasOf(state);
  const slide = slideRaster(adapter, state);
  const padded = padChrome(slide);
  return {
    png: encodePngRgb(padded),
    width: padded.width,
    height: padded.height,
    slideWidth: slide.width,
    slideHeight: slide.height,
    worldWidth: world.width,
    worldHeight: world.height,
    chrome: visibleChrome(state, chrome),
  };
}

/** Map a click on the padded screenshot back into the vision UI's world space. */
export function imageToWorld(frame: VisionFrame, x: number, y: number): { x: number; y: number } {
  if (y < VISION_PAD_TOP) {
    if (x < 80) return { x: 24, y: -18 };
    if (x < 160) return { x: 104, y: -18 };
    return { x: 184, y: -18 };
  }
  if (y >= VISION_PAD_TOP + frame.slideHeight) {
    return { x: (x / Math.max(frame.width, 1)) * 240, y: frame.worldHeight + 14 };
  }
  return {
    x: ((x - 0) / Math.max(frame.slideWidth, 1)) * frame.worldWidth,
    y: ((y - VISION_PAD_TOP) / Math.max(frame.slideHeight, 1)) * frame.worldHeight,
  };
}
