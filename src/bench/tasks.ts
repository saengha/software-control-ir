import type { State } from "../ir/types.js";
import { boxOf } from "../ir/geometry.js";
import type { GoalCheck } from "./run.js";

function textboxes(state: State) {
  return state.objects.filter((object) => object.type === "textbox");
}

export function boardTitleGoal(state: State): GoalCheck[] {
  const title = textboxes(state).find((object) => object.properties.text === "Board Update");
  const bar = state.objects.find(
    (object) => object.type === "rectangle" && object.properties.fill === "#e6a23c",
  );
  const centered =
    title !== undefined &&
    Math.abs(boxOf(title).x - Math.round((960 - boxOf(title).width) / 2)) <= 2;

  return [
    { id: "has_title", ok: Boolean(title), detail: title?.id ?? "missing Board Update" },
    { id: "has_accent", ok: Boolean(bar), detail: bar?.id ?? "missing accent bar" },
    { id: "title_centered", ok: centered, detail: title ? `x=${boxOf(title).x}` : "no title" },
  ];
}

export function recoveredTitleGoal(state: State): GoalCheck[] {
  const title = state.objects.find((object) => object.id === "title_01");
  return [
    {
      id: "title_restored",
      ok: title?.properties.text === "Board Update",
      detail: String(title?.properties.text ?? "missing"),
    },
  ];
}

export const boardTitleStructured: unknown[] = [
  {
    action: "create_shape",
    id: "title_new",
    kind: "textbox",
    x: 80,
    y: 70,
    width: 800,
    height: 90,
    text: "Board Update",
  },
  { action: "align", target: "title_new", edge: "center" },
  {
    action: "create_shape",
    id: "accent_new",
    kind: "rectangle",
    x: 80,
    y: 180,
    width: 240,
    height: 16,
  },
  { action: "set_fill", target: "accent_new", value: "#e6a23c" },
];

export const boardTitleNaive: unknown[] = [
  { action: "set_text", target: "slide_01", value: "Board Update" },
  { action: "create_shape", kind: "textbox", x: 80, y: 70 },
  {
    action: "create_shape",
    id: "title_new",
    kind: "textbox",
    x: 80,
    y: 70,
    width: 800,
    height: 90,
    text: "Board Update",
  },
  { action: "align", target: "title_new", edge: "center" },
  { action: "set_fill", target: "title_new", value: "yellow" },
  {
    action: "create_shape",
    id: "accent_new",
    kind: "rectangle",
    x: 80,
    y: 180,
    width: 240,
    height: 16,
  },
  { action: "set_fill", target: "accent_new", value: "#e6a23c" },
];

export const recoverTitleActions: unknown[] = [
  { action: "set_text", target: "title_01", value: "Board Update" },
  { action: "set_text", target: "title_01", value: "" },
  { action: "rollback", params: { revision: 1 } },
];

/** A batch whose last action is invalid, so the accepted prefix must not survive. */
export const brandingBatch: unknown[] = [
  { action: "set_text", target: "title_01", value: "Rebranded" },
  { action: "set_fill", target: "accent_01", value: "#2f6f5f" },
  { action: "set_fill", target: "logo_01", value: "#2f6f5f" },
];

export function untouchedTitleGoal(state: State): GoalCheck[] {
  const title = state.objects.find((object) => object.id === "title_01");
  const accent = state.objects.find((object) => object.id === "accent_01");
  return [
    {
      id: "title_untouched",
      ok: title?.properties.text === "Quarterly Review",
      detail: String(title?.properties.text ?? "missing"),
    },
    {
      id: "accent_untouched",
      ok: accent?.properties.fill === "#e6a23c",
      detail: String(accent?.properties.fill ?? "missing"),
    },
  ];
}
