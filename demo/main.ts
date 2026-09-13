import {
  boxOf,
  byZ,
  compactResult,
  compactTransaction,
  containsPoint,
  formatAgentView,
  LabAdapter,
  measureState,
  positionOf,
  resizeHandle,
  runDefaultBench,
  Session,
  SlidesAdapter,
  toolDescriptors,
  type ActionResult,
  type Adapter,
  type ScirObject,
} from "../src/index.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const ctx = canvas.getContext("2d")!;
const stateEl = document.querySelector("#state")!;
const resultEl = document.querySelector("#result")!;
const resultStatus = document.querySelector("#result-status")!;
const revisionEl = document.querySelector("#revision")!;
const historyEl = document.querySelector("#history")!;
const opEl = document.querySelector<HTMLSelectElement>("#op")!;
const targetEl = document.querySelector<HTMLSelectElement>("#target")!;
const paramEl = document.querySelector<HTMLInputElement>("#param")!;
const paramWrap = document.querySelector("#param-wrap")!;
const paramName = document.querySelector("#param-name")!;
const rawEl = document.querySelector<HTMLTextAreaElement>("#raw")!;
const applyBtn = document.querySelector("#apply")!;
const resetBtn = document.querySelector("#reset")!;
const relevantEl = document.querySelector<HTMLInputElement>("#relevant")!;
const toolbar = document.querySelector("#toolbar")!;
const modeSlides = document.querySelector("#mode-slides")!;
const modeLab = document.querySelector("#mode-lab")!;
const sizeEl = document.querySelector("#size")!;
const undoBtn = document.querySelector("#undo")!;
const toolsBtn = document.querySelector("#tools")!;
const batchBtn = document.querySelector("#batch")!;

let session = new Session(new SlidesAdapter());
let mode: "slides" | "lab" = "slides";
let lastResult: ActionResult | undefined;
/** Shift-click marks extra shapes. This is demo UI state, not IR selection. */
let marked: string[] = [];
let panel: { status: string; body: unknown } | undefined;
let drag:
  | {
      id: string;
      kind: "move" | "resize";
      grabbed: boolean;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    }
  | undefined;
let preview: { id: string; x: number; y: number; width?: number; height?: number } | undefined;

function adapter(): Adapter {
  return mode === "slides" ? new SlidesAdapter() : new LabAdapter();
}

function selectedId(): string | undefined {
  return session.snapshot().selection[0];
}

/** Marked shapes if the user shift-clicked, otherwise the current selection. */
function groupIds(): string[] {
  if (marked.length > 0) return marked;
  const selected = selectedId();
  return selected ? [selected] : [];
}

function toCanvas(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function visibleObjects(): ScirObject[] {
  if (mode !== "slides") return session.snapshot().objects;
  return byZ(session.relevant().objects.filter((object) => object.type !== "slide"));
}

function objectAt(x: number, y: number): ScirObject | undefined {
  if (mode === "lab") {
    return [...session.snapshot().objects].reverse().find((object) => {
      const [ox, oy] = positionOf(object);
      return x >= ox - 70 && x <= ox + 70 && y >= oy - 48 && y <= oy + 48;
    });
  }
  return [...visibleObjects()].reverse().find((object) => containsPoint(boxOf(object), x, y));
}

function heatColor(temp: number): string {
  const t = Math.max(0, Math.min(1, temp / 400));
  return `rgb(${Math.round(80 + 175 * t)} ${Math.round(40 + 40 * (1 - t))} ${Math.round(28 + 20 * (1 - t))})`;
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLab() {
  canvas.width = 840;
  canvas.height = 420;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "12px 'IBM Plex Mono', monospace";
  for (const object of session.snapshot().objects) {
    let [x, y] = positionOf(object);
    if (preview?.id === object.id) {
      x = preview.x;
      y = preview.y;
    }
    const selected = session.snapshot().selection.includes(object.id);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = object.type === "heater" ? heatColor(Number(object.properties.temperature) || 0) : "#1d2a28";
    ctx.strokeStyle = selected ? "#e6a23c" : "#3b4530";
    ctx.lineWidth = selected ? 3 : 1;
    roundRect(-70, -48, 140, 96, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f4f0e1";
    ctx.fillText(object.id, -58, -26);
    ctx.fillStyle = "#d9d3c0";
    ctx.fillText(
      object.type === "heater" ? `${object.properties.temperature} C` : `level ${object.properties.level}%`,
      -58,
      -8,
    );
    ctx.fillText(object.properties.locked === true ? "locked" : "editable", -58, 12);
    ctx.restore();
  }
}

function drawSlides() {
  canvas.width = 960;
  canvas.height = 540;
  ctx.fillStyle = "#f3efe2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "16px 'IBM Plex Sans', sans-serif";

  for (const object of visibleObjects()) {
    const box = boxOf(object);
    const x = preview?.id === object.id ? preview.x : box.x;
    const y = preview?.id === object.id ? preview.y : box.y;
    const width = preview?.id === object.id && preview.width !== undefined ? preview.width : box.width;
    const height = preview?.id === object.id && preview.height !== undefined ? preview.height : box.height;
    const selected = session.snapshot().selection.includes(object.id);
    const fill = typeof object.properties.fill === "string" ? object.properties.fill : "#4e7f74";

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = selected ? "#c47a12" : "#2a3120";
    ctx.lineWidth = selected ? 3 : 1;
    if (object.type === "group") {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = selected ? "#c47a12" : "#7d8a6a";
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 6, y - 6, width + 12, height + 12);
      ctx.setLineDash([]);
      ctx.fillStyle = selected ? "#c47a12" : "#7d8a6a";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(object.id, x - 6, y - 12);
      ctx.font = "16px 'IBM Plex Sans', sans-serif";
      ctx.restore();
      continue;
    }
    if (marked.includes(object.id)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#e6a23c";
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 4, y - 4, width + 8, height + 8);
      ctx.setLineDash([]);
      ctx.strokeStyle = selected ? "#c47a12" : "#2a3120";
      ctx.lineWidth = selected ? 3 : 1;
    }
    if (object.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
    }

    const text = typeof object.properties.text === "string" ? object.properties.text : "";
    if (text) {
      ctx.fillStyle = fill === "#0f1a14" ? "#f3efe2" : "#10140e";
      ctx.fillText(text, x + 16, y + Math.min(36, height / 2 + 6), width - 24);
    }

    if (object.properties.locked === true) {
      ctx.fillStyle = "#c47a12";
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText("locked", x + 8, y + height - 10);
      ctx.font = "16px 'IBM Plex Sans', sans-serif";
    }

    if (selected) {
      const handle = resizeHandle({ x, y, width, height });
      ctx.fillStyle = "#e6a23c";
      ctx.fillRect(handle.x, handle.y, handle.width, handle.height);
    }
    ctx.restore();
  }
}

function draw() {
  if (mode === "lab") drawLab();
  else drawSlides();
}

function composeAction(): Record<string, unknown> {
  const name = opEl.value;
  const target = targetEl.value || selectedId();
  const selected = session.snapshot().objects.find((item) => item.id === target);
  const box = selected ? boxOf(selected) : { x: 80, y: 80, width: 160, height: 90 };
  const bare: Record<string, unknown> = (() => {
    switch (name) {
      case "set_temperature":
        return { action: name, target, value: Number(paramEl.value) || 150 };
      case "set_level":
        return { action: name, target, value: Number(paramEl.value) || 50 };
      case "set_locked":
        return { action: name, target, value: paramEl.value === "true" };
      case "set_fill":
        return { action: name, target, value: paramEl.value || "#4e7f74" };
      case "set_text":
        return { action: name, target, value: paramEl.value || "Text" };
      case "move":
        return { action: name, target, x: box.x, y: box.y };
      case "resize":
        return { action: name, target, width: box.width, height: box.height };
      case "align":
        return { action: name, target, edge: paramEl.value || "center" };
      case "create_shape":
        return {
          action: name,
          kind: paramEl.value || "rectangle",
          x: 120,
          y: 260,
          width: 180,
          height: 90,
        };
      case "create":
        return { action: name, id: paramEl.value || "heater_03", type: "heater", x: 240, y: 310 };
      case "group":
        return { action: name, ids: groupIds() };
      case "undo":
        return { action: name };
      case "select":
      case "set_active_slide":
      case "delete":
      case "duplicate":
      case "bring_to_front":
      case "send_to_back":
        return target ? { action: name, target } : { action: name };
      default:
        return { action: name, target };
    }
  })();
  return { ...bare, expectedRevision: session.snapshot().revision };
}

function syncComposer() {
  const catalog = session.catalog();
  const objects = session.snapshot().objects;
  const previousOp = opEl.value;
  const previousTarget = targetEl.value || selectedId();

  opEl.innerHTML = catalog.map((operation) => `<option value="${operation.name}">${operation.name}</option>`).join("");
  if (catalog.some((operation) => operation.name === previousOp)) opEl.value = previousOp;

  targetEl.innerHTML =
    `<option value="">(none)</option>` +
    objects.map((object) => `<option value="${object.id}">${object.id}</option>`).join("");
  if (previousTarget && objects.some((object) => object.id === previousTarget)) {
    targetEl.value = previousTarget;
  }

  const needsParam = ["set_temperature", "set_level", "set_locked", "create", "create_shape", "set_fill", "set_text", "align"].includes(
    opEl.value,
  );
  paramWrap.classList.toggle("hidden", !needsParam);
  paramName.textContent =
    opEl.value === "set_locked"
      ? "value (true/false)"
      : opEl.value === "create"
        ? "id"
        : opEl.value === "create_shape"
          ? "kind"
          : opEl.value === "align"
            ? "edge"
            : "value";
  rawEl.value = JSON.stringify(composeAction(), null, 2);
}

function render(result?: ActionResult) {
  if (result) {
    lastResult = result;
    panel = undefined;
  }
  const state = relevantEl.checked ? session.relevant() : session.snapshot();
  revisionEl.textContent = String(session.snapshot().revision);
  stateEl.textContent = `${formatAgentView(state, session.catalog())}\n\n${JSON.stringify(state, null, 2)}`;

  const shown = measureState(state);
  const size = session.size();
  sizeEl.textContent = `showing ${shown.objects} objects, ~${shown.approxTokens} tokens · full document ${size.full.objects} objects, ~${size.full.approxTokens} tokens`;

  const status = panel?.status ?? lastResult?.status ?? "idle";
  resultStatus.textContent = status;
  resultStatus.className = `hint ${status}`;
  resultEl.textContent = panel
    ? JSON.stringify(panel.body, null, 2)
    : lastResult
      ? JSON.stringify(compactResult(lastResult), null, 2)
      : "Apply an action to see validation, effects, and the resulting revision.";

  const records = session.history();
  historyEl.innerHTML =
    `<li data-rev="0">rev 0 · initial state</li>` +
    records
      .map(
        (record) =>
          `<li data-rev="${record.revision}">rev ${record.revision} · ${record.action.action}${
            record.action.target ? ` ${record.action.target}` : ""
          }</li>`,
      )
      .join("");

  toolbar.classList.toggle("hidden", mode !== "slides");
  modeSlides.classList.toggle("on", mode === "slides");
  modeLab.classList.toggle("on", mode === "lab");
  const caption = document.querySelector("#caption")!;
  caption.innerHTML =
    mode === "slides"
      ? `Shapes are created through <code>create_shape</code>, not by painting pixels. Drag moves. Corner handle resizes. Shift-click marks shapes to <code>group</code>. The catalog is PPT-like, not a universal drawing language.`
      : `Temperature and lock state come from the application. A screenshot would still have to infer them.`;
  syncComposer();
  draw();
}

function applyRaw(raw: unknown) {
  if (Array.isArray(raw)) {
    const outcome = session.transaction(raw);
    marked = [];
    lastResult = undefined;
    panel = { status: outcome.status, body: compactTransaction(outcome) };
    render();
    return;
  }
  marked = [];
  render(session.apply(raw));
}

function showPanel(status: string, body: unknown) {
  lastResult = undefined;
  panel = { status, body };
  render();
}

function setMode(next: "slides" | "lab") {
  mode = next;
  session = new Session(adapter());
  lastResult = undefined;
  panel = undefined;
  marked = [];
  preview = undefined;
  drag = undefined;
  render();
}

canvas.addEventListener("pointerdown", (event) => {
  const point = toCanvas(event);
  const object = objectAt(point.x, point.y);
  if (event.shiftKey && mode === "slides" && object) {
    marked = marked.includes(object.id)
      ? marked.filter((id) => id !== object.id)
      : [...marked, object.id];
    draw();
    return;
  }
  if (!object) {
    applyRaw({ action: "select" });
    return;
  }
  applyRaw({ action: "select", target: object.id });
  const box = boxOf(object);
  const handle = resizeHandle(box);
  const kind = mode === "slides" && containsPoint(handle, point.x, point.y) ? "resize" : "move";
  drag = {
    id: object.id,
    kind,
    grabbed: false,
    startX: point.x,
    startY: point.y,
    origX: box.x,
    origY: box.y,
    origW: box.width,
    origH: box.height,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const point = toCanvas(event);
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  if (!drag.grabbed && dx * dx + dy * dy < 16) return;
  drag.grabbed = true;
  if (drag.kind === "resize") {
    preview = {
      id: drag.id,
      x: drag.origX,
      y: drag.origY,
      width: Math.max(8, Math.round(drag.origW + dx)),
      height: Math.max(8, Math.round(drag.origH + dy)),
    };
  } else {
    preview = { id: drag.id, x: Math.round(drag.origX + dx), y: Math.round(drag.origY + dy) };
  }
  draw();
});

canvas.addEventListener("pointerup", () => {
  if (drag?.grabbed && preview) {
    if (drag.kind === "resize" && preview.width !== undefined && preview.height !== undefined) {
      applyRaw({ action: "resize", target: drag.id, width: preview.width, height: preview.height });
    } else {
      applyRaw({ action: "move", target: drag.id, x: preview.x, y: preview.y });
    }
  }
  drag = undefined;
  preview = undefined;
  draw();
});

opEl.addEventListener("change", () => {
  paramEl.value = "";
  syncComposer();
});
targetEl.addEventListener("change", syncComposer);
paramEl.addEventListener("input", () => {
  rawEl.value = JSON.stringify(composeAction(), null, 2);
});
applyBtn.addEventListener("click", () => {
  try {
    applyRaw(JSON.parse(rawEl.value) as unknown);
  } catch (error) {
    resultEl.textContent = error instanceof Error ? error.message : "Invalid JSON";
    resultStatus.textContent = "rejected";
    resultStatus.className = "hint rejected";
  }
});
resetBtn.addEventListener("click", () => {
  marked = [];
  render(session.rollback(0));
});
undoBtn.addEventListener("click", () => {
  marked = [];
  render(session.undo());
});
toolsBtn.addEventListener("click", () => {
  showPanel("tools", { describe: session.describe(), tools: toolDescriptors(session) });
});
batchBtn.addEventListener("click", () => {
  const shapes = session
    .relevant()
    .objects.filter((object) => object.type !== "slide" && object.type !== "group");
  const editable = shapes.find((object) => object.properties.locked !== true);
  const locked = shapes.find((object) => object.properties.locked === true);
  rawEl.value = JSON.stringify(
    [
      { action: "move", target: editable?.id ?? "title_01", x: 200, y: 200 },
      { action: "set_locked", target: locked?.id ?? "logo_01", value: false },
      { action: "set_fill", target: locked?.id ?? "logo_01", value: "not-a-color" },
    ],
    null,
    2,
  );
});
historyEl.addEventListener("click", (event) => {
  const item = (event.target as HTMLElement).closest("li");
  if (!item) return;
  render(session.rollback(Number(item.dataset.rev)));
});
relevantEl.addEventListener("change", () => render());
modeSlides.addEventListener("click", () => setMode("slides"));
modeLab.addEventListener("click", () => setMode("lab"));
toolbar.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button) return;
  const kind = button.getAttribute("data-kind");
  const slide = button.getAttribute("data-slide");
  if (kind) {
    applyRaw({ action: "create_shape", kind, x: 120, y: 260, width: kind === "ellipse" ? 90 : 180, height: 90 });
  } else if (slide) {
    applyRaw({ action: "set_active_slide", target: slide });
  } else if (button.id === "align-center" && selectedId()) {
    applyRaw({ action: "align", target: selectedId(), edge: "center" });
  } else if (button.id === "duplicate" && selectedId()) {
    applyRaw({ action: "duplicate", target: selectedId() });
  } else if (button.id === "bring-front" && selectedId()) {
    applyRaw({ action: "bring_to_front", target: selectedId() });
  } else if (button.id === "send-back" && selectedId()) {
    applyRaw({ action: "send_to_back", target: selectedId() });
  } else if (button.id === "group") {
    applyRaw({ action: "group", ids: groupIds() });
  } else if (button.id === "ungroup" && selectedId()) {
    applyRaw({ action: "ungroup", target: selectedId() });
  } else if (button.id === "measure") {
    showPanel("measured", runDefaultBench());
  }
});

render();
