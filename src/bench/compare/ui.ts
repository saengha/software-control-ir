import { compactResult } from "../../ir/compact.js";
import type { CompactResult, State } from "../../ir/types.js";
import type { Session } from "../../runtime/session.js";
import { hitTarget, findRegion, type VisionObservation, type VisionPick } from "./observe.js";
import type { VisionTool } from "./prompts.js";

export interface UiAction {
  tool: VisionTool;
  x?: number;
  y?: number;
  text?: string;
  direction?: "up" | "down" | "left" | "right";
}

export interface UiChrome {
  armed?: "rectangle" | "ellipse" | "textbox";
  panel?: { fill: string; text: string; locked: boolean; focus: "fill" | "text" };
  toast?: string;
}

export interface UiReply {
  result: CompactResult;
  bound: Record<string, unknown>;
  chrome: UiChrome;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUiAction(value: unknown): value is UiAction {
  return isPlain(value) && typeof value.tool === "string";
}

export function resolveUiAction(raw: UiAction, vision: VisionObservation): UiAction {
  const look = (raw as UiAction & { look?: VisionPick }).look;
  if (!look) return raw;
  const rest: UiAction = { tool: raw.tool };
  if (raw.text !== undefined) rest.text = raw.text;
  if (raw.direction !== undefined) rest.direction = raw.direction;
  if (raw.x !== undefined) rest.x = raw.x;
  if (raw.y !== undefined) rest.y = raw.y;
  const region = findRegion(vision, look);
  if (!region) return rest;
  rest.x = region.x + region.width / 2;
  rest.y = region.y + region.height / 2;
  return rest;
}

function canvasSize(state: State): { width: number; height: number } {
  const active = typeof state.meta?.activeSlide === "string" ? state.meta.activeSlide : undefined;
  const slide = state.objects.find((object) => object.id === active && object.type === "slide");
  return {
    width: typeof slide?.properties.width === "number" ? slide.properties.width : 960,
    height: typeof slide?.properties.height === "number" ? slide.properties.height : 540,
  };
}

function slidesInOrder(state: State) {
  return state.objects.filter((object) => object.type === "slide");
}

function selectedId(state: State): string | undefined {
  return state.selection[0];
}

function emptyResult(session: Session): CompactResult {
  return { status: "accepted", revision: session.snapshot().revision, effects: [] };
}

function toastOf(result: CompactResult): string | undefined {
  const issue = result.issues?.[0];
  if (!issue) return undefined;
  if (issue.code === "locked") return "This object cannot be edited.";
  if (issue.code === "host_diverged") return "The document changed outside this session.";
  return issue.message;
}

function setToast(chrome: UiChrome, result: CompactResult) {
  const toast = toastOf(result);
  if (toast) chrome.toast = toast;
}

function apply(session: Session, raw: unknown): CompactResult {
  return compactResult(session.apply(raw));
}

function objectProps(state: State, id: string | undefined) {
  const object = id ? state.objects.find((item) => item.id === id) : undefined;
  return {
    fill: typeof object?.properties.fill === "string" ? object.properties.fill : "",
    text: typeof object?.properties.text === "string" ? object.properties.text : "",
    locked: object?.properties.locked === true,
    type: object?.type,
  };
}

function toolbarKind(x: number, y: number): UiChrome["armed"] | undefined {
  if (y >= 0) return undefined;
  if (x < 80) return "rectangle";
  if (x < 160) return "ellipse";
  return "textbox";
}

function tabIndex(x: number, y: number, canvas: { width: number; height: number }): number | undefined {
  if (y <= canvas.height) return undefined;
  const index = Math.floor(x / 80);
  return index >= 0 ? index : undefined;
}

/**
 * Pixel-space driver for the vision prompt. Host hit-testing stays inside the
 * runner; the agent only sees screenshots and chrome labels.
 */
export function executeUiAction(session: Session, chrome: UiChrome, raw: UiAction): UiReply {
  const state = session.snapshot();
  const canvas = canvasSize(state);
  const next: UiChrome = { ...chrome };
  delete next.toast;

  if (raw.tool === "screenshot") {
    return { result: emptyResult(session), bound: { tool: "screenshot" }, chrome: next };
  }

  if (raw.tool === "scroll") {
    const slides = slidesInOrder(state);
    const active = typeof state.meta?.activeSlide === "string" ? state.meta.activeSlide : slides[0]?.id;
    const current = Math.max(0, slides.findIndex((slide) => slide.id === active));
    const delta = raw.direction === "up" || raw.direction === "left" ? -1 : 1;
    const target = slides[current + delta];
    if (!target) {
      next.toast = "No more slides in that direction.";
      return { result: emptyResult(session), bound: { tool: "scroll", direction: raw.direction ?? "down" }, chrome: next };
    }
    const result = apply(session, { action: "set_active_slide", target: target.id });
    setToast(next, result);
    delete next.panel;
    delete next.armed;
    return { result, bound: { tool: "scroll", direction: raw.direction ?? "down" }, chrome: next };
  }

  if (raw.tool === "type") {
    const text = raw.text ?? "";
    const target = selectedId(state);
    const focus = chrome.panel?.focus ?? (objectProps(state, target).type === "textbox" ? "text" : "fill");
    const action =
      focus === "fill"
        ? { action: "set_fill", target, value: text }
        : { action: "set_text", target, value: text };
    const result = apply(session, action);
    setToast(next, result);
    return { result, bound: { tool: "type", text, mapped: action.action }, chrome: next };
  }

  const x = raw.x ?? 0;
  const y = raw.y ?? 0;
  const bound: Record<string, unknown> = { tool: raw.tool, x, y };

  const kind = toolbarKind(x, y);
  if (kind) {
    next.armed = kind;
    return { result: emptyResult(session), bound, chrome: next };
  }

  const tab = tabIndex(x, y, canvas);
  if (tab !== undefined) {
    const slides = slidesInOrder(state);
    const target = slides[tab];
    if (!target) {
      next.toast = "No slide tab there.";
      return { result: emptyResult(session), bound, chrome: next };
    }
    const result = apply(session, { action: "set_active_slide", target: target.id });
    setToast(next, result);
    delete next.panel;
    delete next.armed;
    return { result, bound, chrome: next };
  }

  if (chrome.armed && raw.tool === "click") {
    const result = apply(session, {
      action: "create_shape",
      kind: chrome.armed,
      x,
      y,
      width: canvas.width > 400 ? 180 : 60,
      height: canvas.height > 400 ? 100 : 30,
    });
    setToast(next, result);
    delete next.armed;
    return { result, bound: { ...bound, mapped: "create_shape" }, chrome: next };
  }

  const hit = hitTarget(state, x, y);
  const result = apply(session, hit ? { action: "select", target: hit } : { action: "select" });
  setToast(next, result);
  if (raw.tool === "right_click" && hit) {
    const props = objectProps(session.snapshot(), hit);
    next.panel = {
      fill: props.fill,
      text: props.text,
      locked: props.locked,
      focus: props.type === "textbox" ? "text" : "fill",
    };
  } else {
    delete next.panel;
  }
  return { result, bound, chrome: next };
}

export function visibleChrome(state: State, chrome: UiChrome) {
  const canvas = canvasSize(state);
  const tabs = slidesInOrder(state).map((_, index) => ({
    label: `Slide ${index + 1}`,
    x: 40 + index * 80,
    y: canvas.height + 14,
  }));
  const visible: {
    toolbar: { label: string; x: number; y: number }[];
    tabs: { label: string; x: number; y: number }[];
    panel?: { fill: string; text: string };
    toast?: string;
  } = {
    toolbar: [
      { label: "Rectangle", x: 24, y: -18 },
      { label: "Ellipse", x: 104, y: -18 },
      { label: "Text", x: 184, y: -18 },
    ],
    tabs,
  };
  if (chrome.panel) {
    visible.panel = { fill: chrome.panel.fill, text: chrome.panel.text };
  }
  if (chrome.toast) visible.toast = chrome.toast;
  return visible;
}

/** What the vision model is allowed to read back. No IR ids, lock flags, or effects. */
export function visionToolFeedback(state: State, chrome: UiChrome) {
  return visibleChrome(state, chrome);
}
