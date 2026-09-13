import { describe, expect, it } from "vitest";
import {
  Session,
  SlidesAdapter,
  COMPARE_TASKS,
  contrastRatio,
  encodePpm,
  gradeRenderedContrast,
  renderSlideRaster,
  runCompare,
  type CompareTask,
} from "../src/index.js";
import {
  CONTRAST_BG,
  CONTRAST_STRUCTURED_FILL,
  CONTRAST_TEXT,
  CONTRAST_VISION_FILL,
  WCAG_AA_RATIO,
} from "../src/fixtures/contrast.js";

function contrastTask(): CompareTask {
  const task = COMPARE_TASKS.find((entry) => entry.id === "contrast_check");
  if (!task) throw new Error("contrast_check missing");
  return task;
}

function rgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

describe("contrast_check", () => {
  it("fails WCAG AA for the structured fill and passes for the vision fill", () => {
    const white = rgb(CONTRAST_TEXT);
    const structured = contrastRatio(white, rgb(CONTRAST_STRUCTURED_FILL));
    const vision = contrastRatio(white, rgb(CONTRAST_VISION_FILL));
    expect(structured).toBeLessThan(WCAG_AA_RATIO);
    expect(vision).toBeGreaterThanOrEqual(WCAG_AA_RATIO);
    expect(contrastRatio(white, rgb(CONTRAST_BG))).toBeLessThan(WCAG_AA_RATIO);
  });

  it("returns the same contrast from both graders on one rendered image", () => {
    const session = new Session(new SlidesAdapter({ preset: "contrast" }));
    session.apply({ action: "set_fill", target: "bg_01", value: CONTRAST_STRUCTURED_FILL });
    const raster = renderSlideRaster(session.snapshot());
    const structuredGrader = gradeRenderedContrast(session.snapshot(), raster);
    const visionGrader = gradeRenderedContrast(session.snapshot(), raster);
    expect(structuredGrader.ratio).toBe(visionGrader.ratio);
    expect(structuredGrader.passes).toBe(visionGrader.passes);
    expect(structuredGrader.passes).toBe(false);
    expect(encodePpm(raster).subarray(0, 2).toString()).toBe("P6");
  });

  it("does not treat a successful set_fill as task success", () => {
    const adapter = new SlidesAdapter({ preset: "contrast" });
    const structured = runCompare(adapter, contrastTask(), "structured");
    expect(structured.metrics.accepted).toBeGreaterThan(0);
    expect(structured.metrics.verdict).toBe("FAILED");
    expect(structured.checks.some((check) => check.id === "wcag_contrast" && !check.ok)).toBe(true);

    const visionAdapter = new SlidesAdapter({ preset: "contrast" });
    const vision = runCompare(visionAdapter, contrastTask(), "vision");
    expect(vision.metrics.verdict).toBe("DONE");
    expect(vision.checks.every((check) => check.ok)).toBe(true);
  });
});
