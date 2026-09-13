import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Action,
  AdapterState,
  Capabilities,
  Operation,
  State,
  StateQuery,
  ValidationIssue,
} from "../ir/types.js";
import { coreOperations } from "../ir/core-ops.js";
import { boxOf } from "../ir/geometry.js";
import { cloneJson } from "../ir/normalize.js";
import { matchQuery } from "../ir/query.js";
import type { Adapter } from "../runtime/adapter.js";
import { decodePngRgb, type RgbRaster } from "./impress/png.js";

const SHAPE_KINDS = ["rectangle", "ellipse", "textbox"] as const;
type ShapeKind = (typeof SHAPE_KINDS)[number];

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(here, "impress", "bridge.py");

const domainOperations: Operation[] = [
  {
    name: "move",
    layer: "domain",
    description: "Move a shape's top-left corner, in millimetres. LibreOffice Draw units, not pixels.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: {
      x: { type: "number", required: true, minimum: 0 },
      y: { type: "number", required: true, minimum: 0 },
    },
    reversible: true,
  },
  {
    name: "resize",
    layer: "domain",
    description: "Change a shape's bounding box in millimetres.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: {
      width: { type: "number", required: true, minimum: 1 },
      height: { type: "number", required: true, minimum: 1 },
    },
    reversible: true,
  },
  {
    name: "create_shape",
    layer: "domain",
    description: "Create a rectangle, ellipse, or text box on an Impress slide.",
    target: { required: false },
    params: {
      kind: { type: "string", required: true, enum: [...SHAPE_KINDS] },
      x: { type: "number", required: true, minimum: 0 },
      y: { type: "number", required: true, minimum: 0 },
      width: { type: "number", required: true, minimum: 1 },
      height: { type: "number", required: true, minimum: 1 },
      id: { type: "string" },
      text: { type: "string" },
      parent: { type: "string" },
    },
    reversible: true,
  },
  {
    name: "set_fill",
    layer: "domain",
    description: "Set a shape fill color as a hex string.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: { value: { type: "string", required: true } },
    reversible: true,
  },
  {
    name: "set_text",
    layer: "domain",
    description: "Set text on a shape.",
    target: { required: true, types: [...SHAPE_KINDS] },
    params: { value: { type: "string", required: true } },
    reversible: true,
  },
  {
    name: "set_active_slide",
    layer: "domain",
    description: "Change which slide is current. Relevant state follows this.",
    target: { required: true, types: ["slide"] },
    appliesWhenLocked: true,
    reversible: true,
  },
];

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === "string" && (SHAPE_KINDS as readonly string[]).includes(value);
}

function hexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function fileUrl(abs: string): string {
  return "file:///" + encodeURI(path.resolve(abs).replace(/\\/g, "/"));
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPort(python: string, port: number, timeoutMs: number, child?: ChildProcess) {
  const started = Date.now();
  const script = `import socket;s=socket.create_connection(("127.0.0.1",${port}),2);s.close()`;
  while (Date.now() - started < timeoutMs) {
    if (child?.exitCode != null) {
      throw new Error(`LibreOffice exited before listening (code ${child.exitCode})`);
    }
    try {
      execFileSync(python, ["-c", script], { encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: "ignore" });
      return;
    } catch {
      sleepSync(200);
    }
  }
  throw new Error(`LibreOffice did not listen on 127.0.0.1:${port}`);
}

/** Kill a spawned soffice.bin tree. Matches only our private profile directory name. */
function killOfficeTree(pid: number | undefined, profile: string) {
  if (pid) {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // already gone
    }
  }
  const needle = path.basename(profile).replace(/'/g, "");
  if (!needle.startsWith("scir-lo-")) return;
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'soffice' -and $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore", windowsHide: true },
    );
  } catch {
    // no matching process
  }
}

export function defaultImpressDocument(): string {
  return path.resolve(path.join(here, "..", "..", "fixtures", "impress", "board.odp"));
}

export function defaultImpressContrastDocument(): string {
  return path.resolve(path.join(here, "..", "..", "fixtures", "impress", "contrast.odp"));
}

/** Copy the committed deck so tests never write the repository file. */
export function copyImpressDocument(source = defaultImpressDocument()): string {
  const dir = mkdtempSync(path.join(tmpdir(), "scir-odp-"));
  const dest = path.join(dir, path.basename(source));
  copyFileSync(source, dest);
  return dest;
}

export function libreOfficeProgram(): string | undefined {
  const fromEnv = process.env.SCIR_LIBREOFFICE;
  const candidates = [
    fromEnv,
    path.join("C:", "Program Files", "LibreOffice", "program"),
    path.join("C:", "Program Files (x86)", "LibreOffice", "program"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find(
    (dir) =>
      existsSync(path.join(dir, "soffice.com")) &&
      existsSync(path.join(dir, "soffice.bin")) &&
      existsSync(path.join(dir, "python.exe")),
  );
}

function freePort(python: string): number {
  const script =
    "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()";
  return Number(execFileSync(python, ["-c", script], { encoding: "utf8" }).trim());
}

interface BridgeReply {
  ok: boolean;
  result?: AdapterState | ImpressIsolation | { ready?: boolean };
  error?: string;
}

export interface ImpressIsolation {
  user: string;
  install: string;
}

export interface ImpressAdapterOptions {
  document?: string;
  /** Factory-seed a board or contrast deck. Only for writing committed .odp fixtures. */
  seed?: boolean | "contrast";
}

export class ImpressAdapter implements Adapter {
  readonly id = "impress";
  readonly domain = "presentation";
  private readonly program: string;
  private readonly python: string;
  private readonly port: number;
  private readonly profile: string;
  private readonly seed: false | true | "contrast";
  private document: string | undefined;
  private office: ChildProcess | undefined;
  private isolated: ImpressIsolation | undefined;

  constructor(options?: ImpressAdapterOptions) {
    const program = libreOfficeProgram();
    if (!program) {
      throw new Error("LibreOffice was not found. Set SCIR_LIBREOFFICE to the program directory.");
    }
    this.program = program;
    this.python = path.join(program, "python.exe");
    this.port = freePort(this.python);
    this.profile = mkdtempSync(path.join(tmpdir(), "scir-lo-"));
    this.seed = options?.seed === "contrast" ? "contrast" : options?.seed === true;
    this.document = options?.document ? path.resolve(options.document) : defaultImpressDocument();
    if (!this.seed && !existsSync(this.document)) {
      throw new Error(`Impress document not found: ${this.document}`);
    }
    this.startOffice();
    try {
      waitForPort(this.python, this.port, 60_000, this.office);
      const ready = this.rpc("bootstrap", this.bootstrapArgs(), 90_000) as ImpressIsolation & {
        ready?: boolean;
      };
      this.isolated = { user: ready.user, install: ready.install };
      this.assertPrivateProfile();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  static available(): boolean {
    return Boolean(libreOfficeProgram()) && existsSync(bridgePath);
  }

  catalog(): Operation[] {
    return [...coreOperations(), ...cloneJson(domainOperations)];
  }

  capabilities(): Partial<Capabilities> {
    return { snapshotRestore: true, hierarchy: true, compensation: true };
  }

  isolation(): ImpressIsolation {
    if (this.isolated) return this.isolated;
    const result = this.rpc("isolate") as ImpressIsolation;
    this.isolated = result;
    return result;
  }

  profilePath(): string {
    return this.profile;
  }

  snapshot(query?: StateQuery): AdapterState {
    const state = this.rpc("snapshot") as AdapterState;
    const next: AdapterState = {
      objects: cloneJson(state.objects.filter((object) => matchQuery(object, query))),
      selection: cloneJson(state.selection),
    };
    if (state.meta !== undefined) next.meta = cloneJson(state.meta);
    return next;
  }

  fixtures() {
    return {
      validAction: {
        action: "create_shape",
        params: { kind: "rectangle", x: 40, y: 80, width: 60, height: 30, id: "rect_new" },
      },
      invalidAction: {
        action: "set_fill",
        target: "logo_01",
        params: { value: "#ff0000" },
      },
    };
  }

  check(action: Action, state: State): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (action.action === "create_shape") {
      const parent =
        typeof action.params.parent === "string"
          ? action.params.parent
          : typeof state.meta?.activeSlide === "string"
            ? state.meta.activeSlide
            : "slide_01";
      const parentObject = state.objects.find((object) => object.id === parent);
      if (!parentObject || parentObject.type !== "slide") {
        issues.push({ code: "unknown_target", message: `Slide "${parent}" does not exist`, path: "parent" });
      }
      if (typeof action.params.id === "string" && state.objects.some((object) => object.id === action.params.id)) {
        issues.push({
          code: "duplicate_target",
          message: `Object "${action.params.id}" already exists`,
          path: "id",
        });
      }
      if (!isShapeKind(action.params.kind)) {
        issues.push({ code: "invalid_params", message: "kind must be rectangle, ellipse, or textbox", path: "kind" });
      }
    }
    if (action.action === "set_fill" && !hexColor(action.params.value)) {
      issues.push({ code: "invalid_params", message: "Fill must be a hex color like #e6a23c", path: "value" });
    }
    return issues;
  }

  inverse(action: Action, before: State): Action | undefined {
    const target = action.target;
    const object = target ? before.objects.find((item) => item.id === target) : undefined;
    switch (action.action) {
      case "set_text":
      case "set_fill":
      case "set_locked": {
        if (!object || !target) return undefined;
        const key = action.action === "set_text" ? "text" : action.action === "set_fill" ? "fill" : "locked";
        return { action: action.action, target, params: { value: object.properties[key] ?? null } };
      }
      case "move": {
        if (!object || !target) return undefined;
        const box = boxOf(object);
        return { action: "move", target, params: { x: box.x, y: box.y } };
      }
      case "resize": {
        if (!object || !target) return undefined;
        const box = boxOf(object);
        return { action: "resize", target, params: { width: box.width, height: box.height } };
      }
      case "create_shape": {
        const id = action.params.id;
        return typeof id === "string" ? { action: "delete", target: id, params: {} } : undefined;
      }
      case "select": {
        const previous = before.selection[0];
        return previous ? { action: "select", target: previous, params: {} } : { action: "select", params: {} };
      }
      case "set_active_slide": {
        const active = before.meta?.activeSlide;
        return typeof active === "string"
          ? { action: "set_active_slide", target: active, params: {} }
          : undefined;
      }
      default:
        return undefined;
    }
  }

  execute(action: Action, _state: State) {
    this.rpc("execute", { action }, 30_000);
    return {};
  }

  restore(state: AdapterState): void {
    this.rpc("restore", { state }, 60_000);
  }

  save(filePath = this.document): void {
    const target = filePath ?? this.document;
    if (!target) throw new Error("No document path to save");
    this.rpc("save", { url: fileUrl(target) }, 30_000);
    this.document = path.resolve(target);
  }

  exportPng(filePath: string): void {
    this.rpc("export_png", { url: fileUrl(filePath) }, 30_000);
  }

  /** Host render of the current page, used by contrast_check. Falls back to the caller. */
  exportRaster(): RgbRaster {
    const dir = mkdtempSync(path.join(tmpdir(), "scir-png-"));
    const dest = path.join(dir, "slide.png");
    try {
      this.exportPng(dest);
      return decodePngRgb(readFileSync(dest));
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may still hold the temp file
      }
    }
  }

  load(filePath: string): void {
    const resolved = path.resolve(filePath);
    this.rpc("load", { url: fileUrl(resolved) }, 30_000);
    this.document = resolved;
  }

  /** Reload the current .odp from disk. */
  reset(): void {
    if (this.seed) {
      this.rpc("bootstrap", this.bootstrapArgs(), 90_000);
      return;
    }
    if (!this.document) throw new Error("No document to reload");
    this.rpc("load", { url: fileUrl(this.document) }, 30_000);
  }

  close(): void {
    try {
      this.rpc("shutdown", {}, 15_000);
    } catch {
      // soffice may already be gone
    }
    killOfficeTree(this.office?.pid, this.profile);
    this.office = undefined;
    const lock = path.join(this.profile, ".lock");
    for (let i = 0; i < 20 && existsSync(lock); i += 1) {
      sleepSync(100);
    }
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      // Windows sometimes holds a file until soffice fully exits
    }
  }

  private bootstrapArgs(): Record<string, unknown> {
    if (this.seed === "contrast") return { seed: "contrast" };
    if (this.seed) return { seed: true };
    return { document: fileUrl(this.document ?? defaultImpressDocument()) };
  }

  private startOffice() {
    // Windows entry point is soffice.com. Direct soffice.bin exits immediately
    // and never opens --accept. Isolation is a private UserInstallation plus
    // --nolockcheck, not bypassing the loader. Joining the desktop singleton
    // is what later surfaces as a bogus bootstrap.ini error.
    const soffice = path.join(this.program, "soffice.com");
    this.office = spawn(
      soffice,
      [
        "--headless",
        "--invisible",
        "--nologo",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `--accept=socket,host=127.0.0.1,port=${this.port};urp;StarOffice.ComponentContext`,
        `-env:UserInstallation=${fileUrl(this.profile)}`,
      ],
      {
        cwd: this.program,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PATH: `${this.program}${path.delimiter}${process.env.PATH ?? ""}`,
          OOO_DISABLE_RECOVERY: "1",
          SAL_NO_NATIVE_MESSAGEBOX: "1",
        },
      },
    );
  }

  private assertPrivateProfile() {
    const user = (this.isolated?.user ?? "").replace(/\\/g, "/").toLowerCase();
    const profile = this.profile.replace(/\\/g, "/").toLowerCase();
    if (!user.includes(path.basename(this.profile).toLowerCase()) && !user.includes(profile)) {
      throw new Error(`LibreOffice is not using the private profile (${this.isolated?.user ?? "unknown"})`);
    }
    if (user.includes("appdata/roaming/libreoffice")) {
      throw new Error("LibreOffice attached to the desktop user profile");
    }
  }

  private rpc(method: string, extra: Record<string, unknown> = {}, timeout = 30_000): unknown {
    const input = JSON.stringify({ method, ...extra });
    let stdout: string;
    try {
      stdout = execFileSync(this.python, [bridgePath, "--port", String(this.port)], {
        cwd: this.program,
        encoding: "utf8",
        timeout,
        windowsHide: true,
        input,
        env: { ...process.env, PATH: `${this.program}${path.delimiter}${process.env.PATH ?? ""}` },
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; message: string };
      stdout = failed.stdout ?? "";
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("SCIR_JSON:"));
      if (!line) {
        throw new Error(failed.stderr?.trim() || failed.message);
      }
      const reply = JSON.parse(line.slice("SCIR_JSON:".length)) as BridgeReply;
      throw new Error(reply.error ?? failed.message);
    }

    const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("SCIR_JSON:"));
    if (!line) {
      throw new Error(`Impress bridge returned no JSON: ${stdout.slice(0, 300)}`);
    }
    const reply = JSON.parse(line.slice("SCIR_JSON:".length)) as BridgeReply;
    if (!reply.ok) {
      throw new Error(reply.error ?? "Impress bridge failed");
    }
    return reply.result;
  }
}
