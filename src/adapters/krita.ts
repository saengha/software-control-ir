import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.join(here, "krita", "bridge");
const pluginInit = path.join(pluginDir, "scir_bridge", "__init__.py");
const runnerScript = path.join(pluginDir, "scir_runner.py");

const domainOperations: Operation[] = [
  {
    name: "set_opacity",
    layer: "domain",
    description: "Set a layer opacity as a percentage 0-100. This is not a fill color.",
    target: { required: true, types: ["layer"] },
    params: { value: { type: "number", required: true, minimum: 0, maximum: 100 } },
    reversible: true,
  },
  {
    name: "set_visible",
    layer: "domain",
    description: "Show or hide a layer. This is not a lock flag.",
    target: { required: true, types: ["layer"] },
    params: { value: { type: "boolean", required: true } },
    reversible: true,
  },
  {
    name: "create_layer",
    layer: "domain",
    description: "Create a paint layer on the Krita document.",
    target: { required: false },
    params: {
      kind: { type: "string", required: true, enum: ["paint"] },
      id: { type: "string" },
      parent: { type: "string" },
    },
    reversible: true,
  },
];

export function kritaProgram(): string | undefined {
  const fromEnv = process.env.SCIR_KRITA;
  const files = [
    fromEnv,
    fromEnv ? path.join(fromEnv, "krita.exe") : undefined,
    fromEnv ? path.join(fromEnv, "bin", "krita.exe") : undefined,
    path.join("C:", "Program Files", "Krita (x64)", "bin", "krita.exe"),
    path.join("C:", "Program Files", "Krita", "bin", "krita.exe"),
    path.join("C:", "Program Files (x86)", "Krita (x64)", "bin", "krita.exe"),
  ].filter((value): value is string => Boolean(value));
  return files.find((candidate) => existsSync(candidate));
}

export function kritaRunnerProgram(): string | undefined {
  const krita = kritaProgram();
  if (!krita) return undefined;
  const runner = path.join(path.dirname(krita), process.platform === "win32" ? "kritarunner.exe" : "kritarunner");
  return existsSync(runner) ? runner : undefined;
}

export function kritaRunnerPykrita(): string | undefined {
  const appdata = process.env.APPDATA;
  if (!appdata) return undefined;
  return path.join(appdata, "kritarunner", "krita", "pykrita");
}

export function defaultKritaDocument(): string {
  return path.resolve(path.join(here, "..", "..", "fixtures", "krita", "board.kra"));
}

export function copyKritaDocument(source = defaultKritaDocument()): string {
  const dir = mkdtempSync(path.join(tmpdir(), "scir-krita-"));
  const dest = path.join(dir, path.basename(source));
  copyFileSync(source, dest);
  return dest;
}

export interface KritaAdapterOptions {
  document?: string;
  seed?: boolean;
}

export class KritaAdapter implements Adapter {
  readonly id = "krita";
  readonly domain = "raster";
  private readonly krita: string;
  private readonly port: number;
  private readonly workspace: string;
  private readonly seed: boolean;
  private readonly runnerFiles: string[] = [];
  private document: string | undefined;
  private child: ChildProcess | undefined;
  private pid: number | undefined;

  constructor(options?: KritaAdapterOptions) {
    const krita = kritaProgram();
    if (!krita) {
      throw new Error("Krita was not found. Set SCIR_KRITA to krita.exe.");
    }
    this.krita = krita;
    this.port = freePort();
    this.workspace = mkdtempSync(path.join(tmpdir(), "scir-krita-"));
    mkdirSync(this.workspace, { recursive: true });
    this.seed = options?.seed === true;
    this.document = options?.document ? path.resolve(options.document) : this.seed ? undefined : defaultKritaDocument();
    if (!this.seed && this.document && !existsSync(this.document)) {
      throw new Error(`Krita document not found: ${this.document}`);
    }
    this.startKrita();
    try {
      waitForPort(this.port, 120_000, this.child);
      this.rpc("bootstrap", this.bootstrapArgs(), 90_000);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  static available(): boolean {
    return Boolean(kritaProgram()) && Boolean(kritaRunnerProgram()) && existsSync(pluginInit) && existsSync(runnerScript);
  }

  processId(): number | undefined {
    return this.pid;
  }

  catalog(): Operation[] {
    return [...coreOperations(), ...cloneJson(domainOperations)];
  }

  capabilities(): Partial<Capabilities> {
    // Restore rewrites the exposed layer graph, not pixel contents.
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
        action: "create_layer",
        params: { kind: "paint", id: "paint_new" },
      },
      invalidAction: {
        action: "set_opacity",
        target: "lock_01",
        params: { value: 40 },
      },
    };
  }

  check(action: Action, state: State): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (action.action === "create_layer") {
      if (action.params.kind !== "paint") {
        issues.push({ code: "invalid_params", message: "kind must be paint", path: "kind" });
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
          : state.objects.some((object) => object.id === "document_01")
            ? "document_01"
            : undefined;
      if (parent) {
        const parentObject = state.objects.find((object) => object.id === parent);
        if (!parentObject || (parentObject.type !== "document" && parentObject.type !== "layer")) {
          issues.push({ code: "unknown_target", message: `Parent "${parent}" does not exist`, path: "parent" });
        }
      }
    }
    if (action.action === "set_opacity" && typeof action.params.value === "number") {
      if (action.params.value < 0 || action.params.value > 100) {
        issues.push({ code: "invalid_params", message: "opacity must be 0-100", path: "value" });
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
      case "set_opacity":
        return object && target
          ? { action: "set_opacity", target, params: { value: object.properties.opacity ?? 100 } }
          : undefined;
      case "set_visible":
        return object && target
          ? { action: "set_visible", target, params: { value: object.properties.visible ?? true } }
          : undefined;
      case "create_layer": {
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
      // Krita may already be gone
    }
    killProcessTree(this.pid);
    const pid = this.pid;
    for (let i = 0; i < 30 && pid && pidAlive(pid); i += 1) {
      sleepSync(100);
    }
    this.child = undefined;
    this.pid = undefined;
    this.removeRunnerScript();
    try {
      rmSync(this.workspace, { recursive: true, force: true });
    } catch {
      // Windows can hold a file until Krita fully exits
    }
  }

  private bootstrapArgs(): Record<string, unknown> {
    if (this.seed) return { seed: true };
    return { document: this.document ?? defaultKritaDocument() };
  }

  private startKrita() {
    const runner = kritaRunnerProgram();
    if (!runner) {
      throw new Error("kritarunner was not found next to krita.exe.");
    }
    this.installRunnerScript();
    const bin = path.dirname(this.krita);
    const log = openSync(path.join(this.workspace, "krita-host.log"), "a");
    this.child = spawn(runner, ["-s", "scir_runner", "--", "--port", String(this.port)], {
      cwd: bin,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        SCIR_KRITA_PORT: String(this.port),
        SCIR_KRITA_LOG: path.join(this.workspace, "bridge.log"),
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    this.pid = this.child.pid;
    this.child.on("exit", () => {
      if (this.child) this.child = undefined;
    });
  }

  private installRunnerScript() {
    const dest = kritaRunnerPykrita();
    if (!dest) throw new Error("APPDATA is not set; cannot install the kritarunner bridge script.");
    const pkg = path.join(dest, "scir_bridge");
    mkdirSync(pkg, { recursive: true });
    const runnerDest = path.join(dest, "scir_runner.py");
    const initDest = path.join(pkg, "__init__.py");
    copyFileSync(runnerScript, runnerDest);
    copyFileSync(pluginInit, initDest);
    this.runnerFiles.push(runnerDest, initDest, pkg);
  }

  private removeRunnerScript() {
    for (const file of this.runnerFiles.reverse()) {
      try {
        rmSync(file, { recursive: true, force: true });
      } catch {
        // still in use
      }
    }
    this.runnerFiles.length = 0;
  }

  private rpc(method: string, extra: Record<string, unknown> = {}, timeout = 30_000): unknown {
    if (this.child?.exitCode != null) {
      throw new Error(`PROCESS_ERROR: Krita exited (code ${this.child.exitCode})`);
    }
    try {
      return rpcJson(this.port, { method, ...extra }, timeout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.startsWith("TIMEOUT") ||
        message.startsWith("BRIDGE_ERROR") ||
        message.startsWith("PROCESS_ERROR") ||
        message.startsWith("APPLICATION_ERROR")
      ) {
        throw error;
      }
      throw new Error(`ADAPTER_ERROR: ${message}`);
    }
  }
}
