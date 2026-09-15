import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readdirSync, rmSync, statSync } from "node:fs";
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
import { cloneJson } from "../ir/normalize.js";
import { matchQuery } from "../ir/query.js";
import type { Adapter } from "../runtime/adapter.js";
import { freePort, killProcessTree, pidAlive, rpcJson, sleepSync, waitForPort } from "./host-rpc.js";

const OBJECT_KINDS = ["mesh", "empty", "light"] as const;
type ObjectKind = (typeof OBJECT_KINDS)[number];

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(here, "blender", "bridge.py");

const domainOperations: Operation[] = [
  {
    name: "set_location",
    layer: "domain",
    description: "Set an object's local location in metres. This is not a 2D slide move.",
    target: { required: true, types: [...OBJECT_KINDS] },
    params: {
      x: { type: "number", required: true },
      y: { type: "number", required: true },
      z: { type: "number", required: true },
    },
    reversible: true,
  },
  {
    name: "set_scale",
    layer: "domain",
    description: "Set an object's XYZ scale. This is not a bounding-box resize.",
    target: { required: true, types: [...OBJECT_KINDS] },
    params: {
      x: { type: "number", required: true },
      y: { type: "number", required: true },
      z: { type: "number", required: true },
    },
    reversible: true,
  },
  {
    name: "create_object",
    layer: "domain",
    description: "Create a mesh cube, empty, or light in the Blender scene.",
    target: { required: false },
    params: {
      kind: { type: "string", required: true, enum: [...OBJECT_KINDS] },
      id: { type: "string" },
      parent: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      z: { type: "number" },
    },
    reversible: true,
  },
];

function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === "string" && (OBJECT_KINDS as readonly string[]).includes(value);
}

function vec3(value: unknown): [number, number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    typeof value[2] === "number"
  ) {
    return [value[0], value[1], value[2]];
  }
  return undefined;
}

function looksLikeBlender(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === "blender.exe" || base === "blender";
}

export function blenderProgram(): string | undefined {
  const fromEnv = process.env.SCIR_BLENDER;
  const files: string[] = [];
  if (fromEnv) {
    files.push(fromEnv);
    files.push(path.join(fromEnv, process.platform === "win32" ? "blender.exe" : "blender"));
  }

  const foundations = [
    path.join("C:", "Program Files", "Blender Foundation"),
    path.join("C:", "Program Files (x86)", "Blender Foundation"),
  ];
  for (const root of foundations) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      files.push(path.join(root, entry, process.platform === "win32" ? "blender.exe" : "blender"));
    }
  }

  const exe = process.platform === "win32" ? "blender.exe" : "blender";
  const steamRoots = [
    path.join("C:", "Program Files (x86)", "Steam", "steamapps", "common", "Blender"),
    path.join("C:", "Program Files", "Steam", "steamapps", "common", "Blender"),
  ];
  for (const letter of ["C", "D", "E", "F"]) {
    steamRoots.push(path.join(`${letter}:`, "SteamLibrary", "steamapps", "common", "Blender"));
    steamRoots.push(path.join(`${letter}:`, "Steam", "steamapps", "common", "Blender"));
  }
  for (const root of steamRoots) {
    files.push(path.join(root, exe));
  }

  files.push(exe);

  for (const candidate of files) {
    if (existsSync(candidate) && looksLikeBlender(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

export function defaultBlenderDocument(): string {
  return path.resolve(path.join(here, "..", "..", "fixtures", "blender", "scene.blend"));
}

export function copyBlenderDocument(source = defaultBlenderDocument()): string {
  const dir = mkdtempSync(path.join(tmpdir(), "scir-blend-"));
  const dest = path.join(dir, path.basename(source));
  copyFileSync(source, dest);
  return dest;
}

export interface BlenderAdapterOptions {
  document?: string;
  seed?: boolean;
}

export class BlenderAdapter implements Adapter {
  readonly id = "blender";
  readonly domain = "scene";
  private readonly blender: string;
  private readonly port: number;
  private readonly workspace: string;
  private readonly seed: boolean;
  private document: string | undefined;
  private child: ChildProcess | undefined;
  private pid: number | undefined;
  private logFd: number | undefined;

  constructor(options?: BlenderAdapterOptions) {
    const blender = blenderProgram();
    if (!blender) {
      throw new Error("Blender was not found. Set SCIR_BLENDER to blender.exe.");
    }
    this.blender = blender;
    this.port = freePort();
    this.workspace = mkdtempSync(path.join(tmpdir(), "scir-blend-"));
    this.seed = options?.seed === true;
    this.document = options?.document ? path.resolve(options.document) : this.seed ? undefined : defaultBlenderDocument();
    if (!this.seed && this.document && !existsSync(this.document)) {
      throw new Error(`Blender document not found: ${this.document}`);
    }
    this.startBlender();
    try {
      waitForPort(this.port, 90_000, this.child);
      this.rpc("bootstrap", this.bootstrapArgs(), 90_000);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  static available(): boolean {
    return Boolean(blenderProgram()) && existsSync(bridgePath);
  }

  processId(): number | undefined {
    return this.pid;
  }

  catalog(): Operation[] {
    return [...coreOperations(), ...cloneJson(domainOperations)];
  }

  capabilities(): Partial<Capabilities> {
    // Restore rewrites the exposed IR state space (transforms, lock, hierarchy), not mesh topology.
    return { snapshotRestore: true, hierarchy: true, compensation: true };
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
        action: "create_object",
        params: { kind: "mesh", x: 3, y: 0, z: 0, id: "mesh_new" },
      },
      invalidAction: {
        action: "set_location",
        target: "lock_01",
        params: { x: 4, y: 0, z: 0 },
      },
    };
  }

  check(action: Action, state: State): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (action.action === "create_object") {
      if (!isObjectKind(action.params.kind)) {
        issues.push({
          code: "invalid_params",
          message: "kind must be mesh, empty, or light",
          path: "kind",
        });
      }
      if (typeof action.params.id === "string" && state.objects.some((object) => object.id === action.params.id)) {
        issues.push({
          code: "duplicate_target",
          message: `Object "${action.params.id}" already exists`,
          path: "id",
        });
      }
      const parent =
        typeof action.params.parent === "string"
          ? action.params.parent
          : state.objects.some((object) => object.id === "scene_01")
            ? "scene_01"
            : undefined;
      if (parent) {
        const parentObject = state.objects.find((object) => object.id === parent);
        if (!parentObject) {
          issues.push({ code: "unknown_target", message: `Parent "${parent}" does not exist`, path: "parent" });
        }
      }
    }
    return issues;
  }

  inverse(action: Action, before: State): Action | undefined {
    const target = action.target;
    const object = target ? before.objects.find((item) => item.id === target) : undefined;
    switch (action.action) {
      case "set_locked":
        return object && target
          ? { action: "set_locked", target, params: { value: object.properties.locked ?? false } }
          : undefined;
      case "set_location": {
        const location = object ? vec3(object.properties.location) : undefined;
        return object && target && location
          ? { action: "set_location", target, params: { x: location[0], y: location[1], z: location[2] } }
          : undefined;
      }
      case "set_scale": {
        const scale = object ? vec3(object.properties.scale) : undefined;
        return object && target && scale
          ? { action: "set_scale", target, params: { x: scale[0], y: scale[1], z: scale[2] } }
          : undefined;
      }
      case "create_object": {
        const id = action.params.id;
        return typeof id === "string" ? { action: "delete", target: id, params: {} } : undefined;
      }
      case "select": {
        const previous = before.selection[0];
        return previous ? { action: "select", target: previous, params: {} } : { action: "select", params: {} };
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
    this.rpc("save", { document: path.resolve(target) }, 30_000);
    this.document = path.resolve(target);
  }

  load(filePath: string): void {
    const resolved = path.resolve(filePath);
    this.rpc("load", { document: resolved }, 30_000);
    this.document = resolved;
  }

  reset(): void {
    this.rpc("bootstrap", this.bootstrapArgs(), 90_000);
  }

  close(): void {
    try {
      this.rpc("shutdown", {}, 15_000);
    } catch {
      // Blender may already be gone
    }
    killProcessTree(this.pid);
    const pid = this.pid;
    for (let i = 0; i < 20 && pid && pidAlive(pid); i += 1) {
      sleepSync(100);
    }
    this.child = undefined;
    this.pid = undefined;
    if (this.logFd != null) {
      try {
        closeSync(this.logFd);
      } catch {
        // log file
      }
      this.logFd = undefined;
    }
    try {
      rmSync(this.workspace, { recursive: true, force: true });
    } catch {
      // Windows can hold a file until Blender fully exits
    }
  }

  private bootstrapArgs(): Record<string, unknown> {
    if (this.seed) return { seed: true };
    return { document: this.document ?? defaultBlenderDocument() };
  }

  private startBlender() {
    const localBridge = path.join(this.workspace, "bridge.py");
    copyFileSync(bridgePath, localBridge);
    const logPath = path.join(this.workspace, "blender.log");
    this.logFd = openSync(logPath, "w");
    // Steam/Windows Blender splits --python on spaces. The repo path has spaces;
    // the session temp dir does not. cwd is the Blender install so DLLs resolve.
    const args = ["--background", "--factory-startup", "--python", localBridge, "--", "--port", String(this.port)];
    if (this.seed) args.push("--seed");
    else if (this.document) args.push("--document", this.document);
    this.child = spawn(this.blender, args, {
      cwd: path.dirname(this.blender),
      windowsHide: true,
      stdio: ["ignore", this.logFd, this.logFd],
    });
    this.pid = this.child.pid;
  }

  private rpc(method: string, extra: Record<string, unknown> = {}, timeout = 30_000): unknown {
    if (this.child?.exitCode != null) {
      throw new Error(`PROCESS_ERROR: Blender exited (code ${this.child.exitCode})`);
    }
    try {
      return rpcJson(this.port, { method, ...extra }, timeout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("TIMEOUT") || message.startsWith("BRIDGE_ERROR") || message.startsWith("PROCESS_ERROR")) {
        throw error;
      }
      if (message.startsWith("APPLICATION_ERROR")) throw error;
      throw new Error(`ADAPTER_ERROR: ${message}`);
    }
  }
}
