import {
  formatAgentView,
  LabAdapter,
  positionOf,
  Session,
  type ActionResult,
  type ScirObject,
} from "../src/index.ts";

const session = new Session(new LabAdapter());
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

let drag:
  | { id: string; grabbed: boolean; startX: number; startY: number; origX: number; origY: number }
  | undefined;
let preview: { id: string; x: number; y: number } | undefined;
let lastResult: ActionResult | undefined;

function selectedId(): string | undefined {
  return session.snapshot().selection[0];
}

function objectAt(x: number, y: number): ScirObject | undefined {
  const objects = [...session.snapshot().objects].reverse();
  return objects.find((object) => {
    const [ox, oy] = positionOf(object);
    return x >= ox - 70 && x <= ox + 70 && y >= oy - 48 && y <= oy + 48;
  });
}

function toCanvas(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function heatColor(temp: number): string {
  const t = Math.max(0, Math.min(1, temp / 400));
  const r = Math.round(80 + 175 * t);
  const g = Math.round(40 + 40 * (1 - t));
  const b = Math.round(28 + 20 * (1 - t));
  return `rgb(${r} ${g} ${b})`;
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

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "12px 'IBM Plex Mono', monospace";

  for (const object of session.snapshot().objects) {
    let [x, y] = positionOf(object);
    if (preview?.id === object.id) {
      x = preview.x;
      y = preview.y;
    }
    const selected = session.snapshot().selection.includes(object.id);
    const locked = object.properties.locked === true;

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = object.type === "heater" ? heatColor(Number(object.properties.temperature) || 0) : "#1d2a28";
    ctx.strokeStyle = selected ? "#e6a23c" : "#3b4530";
    ctx.lineWidth = selected ? 3 : 1;
    roundRect(-70, -48, 140, 96, 10);
    ctx.fill();
    ctx.stroke();

    if (object.type === "vessel") {
      const level = Number(object.properties.level) || 0;
      ctx.fillStyle = "#8fd0c4";
      ctx.globalAlpha = 0.35;
      const fillHeight = 72 * (level / 100);
      ctx.fillRect(-58, 36 - fillHeight, 116, fillHeight);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = "#f4f0e1";
    ctx.fillText(object.id, -58, -26);
    ctx.fillStyle = "#d9d3c0";
    if (object.type === "heater") {
      ctx.fillText(`${object.properties.temperature} C`, -58, -8);
    } else {
      ctx.fillText(`level ${object.properties.level}%`, -58, -8);
    }
    ctx.fillText(locked ? "locked" : "editable", -58, 12);
    ctx.restore();
  }
}

function composeAction(): Record<string, unknown> {
  const name = opEl.value;
  const target = targetEl.value || selectedId();
  switch (name) {
    case "set_temperature":
      return { action: name, target, value: Number(paramEl.value) || 150 };
    case "set_level":
      return { action: name, target, value: Number(paramEl.value) || 50 };
    case "set_locked":
      return { action: name, target, value: paramEl.value === "true" };
    case "move": {
      const object = session.snapshot().objects.find((item) => item.id === target);
      const [x, y] = object ? positionOf(object) : [120, 120];
      return { action: name, target, x, y };
    }
    case "select":
      return target ? { action: name, target } : { action: name };
    case "create":
      return { action: name, id: paramEl.value || "heater_03", type: "heater", x: 240, y: 310 };
    case "delete":
      return { action: name, target };
    default:
      return { action: name, target };
  }
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

  const needsParam = ["set_temperature", "set_level", "set_locked", "create"].includes(opEl.value);
  paramWrap.classList.toggle("hidden", !needsParam);
  paramName.textContent =
    opEl.value === "set_locked" ? "value (true/false)" : opEl.value === "create" ? "id" : "value";
  if (opEl.value === "set_locked" && paramEl.value === "") paramEl.value = "false";
  if ((opEl.value === "set_temperature" || opEl.value === "set_level") && paramEl.value === "") {
    paramEl.value = opEl.value === "set_level" ? "50" : "150";
  }
  rawEl.value = JSON.stringify(composeAction(), null, 2);
}

function render(result?: ActionResult) {
  if (result) lastResult = result;
  const state = session.snapshot();
  revisionEl.textContent = String(state.revision);
  stateEl.textContent = `${formatAgentView(state, session.catalog())}\n\n${JSON.stringify(state, null, 2)}`;
  resultStatus.textContent = lastResult?.status ?? "idle";
  resultStatus.className = `hint ${lastResult?.status ?? ""}`;
  resultEl.textContent = lastResult
    ? JSON.stringify(
        {
          status: lastResult.status,
          revision: lastResult.revision,
          issues: lastResult.issues,
          effects: lastResult.effects,
          focus: lastResult.focus,
        },
        null,
        2,
      )
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

  syncComposer();
  draw();
}

function applyRaw(raw: unknown) {
  render(session.apply(raw));
}

canvas.addEventListener("pointerdown", (event) => {
  const point = toCanvas(event);
  const object = objectAt(point.x, point.y);
  if (!object) {
    applyRaw({ action: "select" });
    return;
  }
  applyRaw({ action: "select", target: object.id });
  const [origX, origY] = positionOf(object);
  drag = { id: object.id, grabbed: false, startX: point.x, startY: point.y, origX, origY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const point = toCanvas(event);
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  if (!drag.grabbed && dx * dx + dy * dy < 16) return;
  drag.grabbed = true;
  preview = { id: drag.id, x: drag.origX + dx, y: drag.origY + dy };
  draw();
});

canvas.addEventListener("pointerup", () => {
  if (drag?.grabbed && preview) {
    applyRaw({
      action: "move",
      target: drag.id,
      x: Math.round(preview.x),
      y: Math.round(preview.y),
    });
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
  render(session.rollback(0));
});
historyEl.addEventListener("click", (event) => {
  const item = (event.target as HTMLElement).closest("li");
  if (!item) return;
  render(session.rollback(Number(item.dataset.rev)));
});

render();
