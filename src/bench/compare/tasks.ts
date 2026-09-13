import type { State } from "../../ir/types.js";
import {
  CONTRAST_STRUCTURED_FILL,
  CONTRAST_TEXT,
  CONTRAST_VISION_FILL,
} from "../../fixtures/contrast.js";
import type { GoalCheck } from "../run.js";
import { formatContrastRatio, gradeRenderedContrast } from "./contrast.js";
import type { SlideRaster } from "./contrast.js";
import { LOCKED_TARGET_POLICY, TASK_CATEGORY, lockedTargetFillAccepted, type TaskCategory } from "./policy.js";
import { HOST_DRIFT_AFTER_STEPS } from "./settings.js";
import { COMPARE_TASK_IDS, isSeedShapeId, type ComparePolicy, type CompareTaskId } from "./protocol.js";

export interface CompareContext {
  adapterId: string;
}

export interface HostInject {
  action: string;
  target: string;
  params: Record<string, string>;
}

export type CompareFixture = "board" | "contrast";

export interface CompareGradeContext {
  raster: SlideRaster;
}

export interface CompareTask {
  id: CompareTaskId;
  category: TaskCategory;
  fixture: CompareFixture;
  /** Same natural-language goal for both prompts. */
  goalText: string;
  maxSteps: number;
  inject?: HostInject;
  /** Mutate the host after this many tool calls. Omit to inject before the loop. */
  injectAfterSteps?: number;
  /** When true, verdict comes from the final rendered image, not IR success. */
  gradeFromRender?: boolean;
  goal: (state: State, ctx: CompareGradeContext) => GoalCheck[];
  script: (policy: ComparePolicy, ctx: CompareContext) => unknown[];
}

function fillOf(state: State, id: string): string {
  const value = state.objects.find((object) => object.id === id)?.properties.fill;
  return typeof value === "string" ? value.toLowerCase() : "";
}

function textOf(state: State, id: string): string {
  const value = state.objects.find((object) => object.id === id)?.properties.text;
  return typeof value === "string" ? value : "";
}

function calloutBox(adapterId: string): Record<string, unknown> {
  if (adapterId === "impress") {
    return { kind: "rectangle", x: 40, y: 80, width: 60, height: 30 };
  }
  return { kind: "rectangle", x: 80, y: 220, width: 180, height: 100 };
}

function boardClicks(adapterId: string) {
  if (adapterId === "impress") {
    return {
      title: { x: 137, y: 26 },
      accent: { x: 52, y: 50 },
      logo: { x: 250, y: 180 },
      empty: { x: 100, y: 110 },
      body: { x: 102, y: 40 },
      rectangleTool: { x: 24, y: -18 },
    };
  }
  return {
    title: { x: 480, y: 115 },
    accent: { x: 200, y: 188 },
    logo: { x: 850, y: 460 },
    empty: { x: 500, y: 320 },
    body: { x: 330, y: 140 },
    rectangleTool: { x: 24, y: -18 },
  };
}

const STEPS = 8;

export const COMPARE_TASKS: CompareTask[] = [
  {
    id: "rename_title",
    category: "execution",
    fixture: "board",
    goalText: 'Change the title on the current slide to "Board Update".',
    maxSteps: STEPS,
    goal: (state) => [
      {
        id: "title_text",
        ok: textOf(state, "title_01") === "Board Update",
        detail: textOf(state, "title_01") || "missing",
      },
    ],
    script: (policy) =>
      policy === "structured"
        ? [{ action: "set_text", target: "title_01", value: "Board Update" }]
        : [
            { tool: "screenshot" },
            { tool: "click", look: { textIncludes: "Quarterly Review" } },
            { tool: "type", text: "Board Update" },
          ],
  },
  {
    id: "recolor_accent",
    category: "execution",
    fixture: "board",
    goalText: "Change the gold accent bar to fill color #2f6f5f.",
    maxSteps: STEPS,
    goal: (state) => [
      {
        id: "accent_fill",
        ok: fillOf(state, "accent_01") === "#2f6f5f",
        detail: fillOf(state, "accent_01") || "missing",
      },
    ],
    script: (policy) =>
      policy === "structured"
        ? [{ action: "set_fill", target: "accent_01", value: "#2f6f5f" }]
        : [
            { tool: "screenshot" },
            { tool: "right_click", look: { fill: "#e6a23c" } },
            { tool: "type", text: "#2f6f5f" },
          ],
  },
  {
    id: "recolor_locked_logo",
    category: "gated",
    fixture: "board",
    goalText: "Change the teal circular logo's fill to #2f6f5f.",
    maxSteps: STEPS,
    goal: (state) => {
      const fill = fillOf(state, "logo_01");
      const changed = fill === "#2f6f5f";
      return [
        {
          id: "logo_fill",
          ok: lockedTargetFillAccepted(changed),
          detail: `policy=${LOCKED_TARGET_POLICY} fill=${fill || "missing"}`,
        },
      ];
    },
    script: (policy) => {
      if (policy === "vision") {
        return [
          { tool: "screenshot" },
          { tool: "right_click", look: { appearance: "oval" } },
          { tool: "type", text: "#2f6f5f" },
        ];
      }
      if (LOCKED_TARGET_POLICY === "unlock_and_apply") {
        return [
          { action: "set_locked", target: "logo_01", value: false },
          { action: "set_fill", target: "logo_01", value: "#2f6f5f" },
        ];
      }
      return [{ action: "set_fill", target: "logo_01", value: "#2f6f5f" }];
    },
  },
  {
    id: "add_callout",
    category: "execution",
    fixture: "board",
    goalText: "Add a new rectangle on the current slide.",
    maxSteps: STEPS,
    goal: (state) => {
      const created = state.objects.find(
        (object) => object.type === "rectangle" && object.parent === "slide_01" && !isSeedShapeId(object.id),
      );
      return [{ id: "has_callout", ok: Boolean(created), detail: created?.id ?? "missing" }];
    },
    script: (policy, ctx) => {
      const box = calloutBox(ctx.adapterId);
      const clicks = boardClicks(ctx.adapterId);
      return policy === "structured"
        ? [{ action: "create_shape", ...box, id: "callout_01" }]
        : [
            { tool: "screenshot" },
            { tool: "click", ...clicks.rectangleTool },
            { tool: "click", ...clicks.empty },
          ];
    },
  },
  {
    id: "edit_hidden_slide",
    category: "gated",
    fixture: "board",
    goalText: 'Open the second slide and change its body text to "Shown now".',
    maxSteps: STEPS,
    goal: (state) => [
      {
        id: "second_slide_active",
        ok: state.meta?.activeSlide === "slide_02",
        detail: String(state.meta?.activeSlide ?? "missing"),
      },
      {
        id: "body_text",
        ok: textOf(state, "body_02") === "Shown now",
        detail: textOf(state, "body_02") || "missing",
      },
    ],
    script: (policy) =>
      policy === "structured"
        ? [
            { action: "set_active_slide", target: "slide_02" },
            { action: "set_text", target: "body_02", value: "Shown now" },
          ]
        : [
            { tool: "screenshot" },
            { tool: "scroll", direction: "down" },
            { tool: "click", look: { textIncludes: "Second slide" } },
            { tool: "type", text: "Shown now" },
          ],
  },
  {
    id: "recover_title",
    category: "gated",
    fixture: "board",
    goalText: 'The title was changed by mistake. Restore it to "Quarterly Review".',
    maxSteps: STEPS,
    goal: (state) => [
      {
        id: "title_restored",
        ok: textOf(state, "title_01") === "Quarterly Review",
        detail: textOf(state, "title_01") || "missing",
      },
    ],
    script: (policy) =>
      policy === "structured"
        ? [{ action: "set_text", target: "title_01", value: "Oops" }, { action: "undo" }]
        : [
            { tool: "screenshot" },
            { tool: "click", look: { textIncludes: "Quarterly Review" } },
            { tool: "type", text: "Oops" },
          ],
  },
  {
    id: "abort_rebrand",
    category: "gated",
    fixture: "board",
    goalText:
      'Rebrand the title to "Rebranded" and the accent and logo to #2f6f5f, but leave the document unchanged if any of those edits cannot be applied.',
    maxSteps: STEPS,
    goal: (state) => [
      {
        id: "title_untouched",
        ok: textOf(state, "title_01") === "Quarterly Review",
        detail: textOf(state, "title_01") || "missing",
      },
      {
        id: "accent_untouched",
        ok: fillOf(state, "accent_01") === "#e6a23c",
        detail: fillOf(state, "accent_01") || "missing",
      },
    ],
    script: (policy) =>
      policy === "structured"
        ? []
        : [
            { tool: "screenshot" },
            { tool: "click", look: { textIncludes: "Quarterly Review" } },
            { tool: "type", text: "Rebranded" },
            { tool: "right_click", look: { fill: "#e6a23c" } },
            { tool: "type", text: "#2f6f5f" },
            { tool: "right_click", look: { appearance: "oval" } },
            { tool: "type", text: "#2f6f5f" },
          ],
  },
  {
    id: "host_drift",
    category: "gated",
    fixture: "board",
    goalText: 'Set the title to "Recovered".',
    maxSteps: STEPS,
    inject: { action: "set_text", target: "title_01", params: { value: "Out of band" } },
    injectAfterSteps: HOST_DRIFT_AFTER_STEPS,
    goal: (state) => [
      {
        id: "title_recovered",
        ok: textOf(state, "title_01") === "Recovered",
        detail: textOf(state, "title_01") || "missing",
      },
    ],
    script: (policy) =>
      policy === "structured"
        ? [
            { action: "select", target: "title_01" },
            { action: "select", target: "accent_01" },
            { action: "select", target: "title_01" },
            { action: "sync" },
            { action: "set_text", target: "title_01", value: "Recovered" },
          ]
        : [
            { tool: "screenshot" },
            { tool: "click", look: { textIncludes: "Quarterly Review" } },
            { tool: "type", text: "Recovered" },
            { tool: "click", look: { textIncludes: "Recovered" } },
          ],
  },
  {
    id: "contrast_check",
    category: "vision-favorable",
    fixture: "contrast",
    gradeFromRender: true,
    goalText: "Change the slide background color to a darker shade of blue.",
    maxSteps: STEPS,
    goal: (state, ctx) => {
      const grade = gradeRenderedContrast(state, ctx.raster);
      return [
        {
          id: "background_darker_blue",
          ok: grade.blue && grade.darker,
          detail: `rgb(${grade.background.join(",")})`,
        },
        {
          id: "wcag_contrast",
          ok: grade.passes,
          detail: `${formatContrastRatio(grade.ratio)} text=${CONTRAST_TEXT}`,
        },
      ];
    },
    script: (policy, ctx) => {
      const clicks = boardClicks(ctx.adapterId);
      return policy === "structured"
        ? [{ action: "set_fill", target: "bg_01", value: CONTRAST_STRUCTURED_FILL }]
        : [
            { tool: "screenshot" },
            { tool: "click", ...clicks.empty },
            { tool: "type", text: CONTRAST_VISION_FILL },
          ];
    },
  },
];

if (COMPARE_TASKS.map((task) => task.id).join() !== COMPARE_TASK_IDS.join()) {
  throw new Error("COMPARE_TASKS must stay aligned with COMPARE_TASK_IDS");
}
if (COMPARE_TASKS.some((task) => task.category !== TASK_CATEGORY[task.id])) {
  throw new Error("COMPARE_TASKS category must match TASK_CATEGORY");
}
