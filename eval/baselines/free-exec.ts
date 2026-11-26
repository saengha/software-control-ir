import vm from "node:vm";
import type { Json } from "../../src/index.js";
import { sameJson } from "../../src/index.js";
import {
  emptyTrace,
  finishTask,
  freshDocument,
  type EvalDocument,
  type ExecutionTrace,
} from "../invariants.js";
import type { EvalDriver, EvalTask, EvalTaskResult, HostInjectSpec, TokenUsage } from "../types.js";

const MAGIC_KEYS = new Set(["__proto__", "constructor", "prototype"]);

interface SandboxFlags {
  issueCodes: string[];
  forbiddenApis: string[];
  pollutionAttempts: string[];
  wroteWhileDrifted: boolean;
  userMutated: boolean;
  rolledBack: boolean;
  syncedDrift: boolean;
  drifted: boolean;
  injected: boolean;
  internal: boolean;
}

interface HistoryEntry {
  id: string;
  key: string;
  value: unknown;
}

function applyInject(raw: EvalDocument, inject: HostInjectSpec): void {
  const object = inject.target ? raw.objects.find((item) => item.id === inject.target) : undefined;
  if (!object) throw new Error(`host inject target "${inject.target ?? ""}" is missing`);
  if (inject.action === "set_text") {
    const value = inject.params.value;
    if (typeof value !== "string") throw new Error("host inject set_text requires a string value");
    object.properties.text = value;
    return;
  }
  if (inject.action === "set_fill") {
    const value = inject.params.value;
    if (typeof value !== "string") throw new Error("host inject set_fill requires a string value");
    object.properties.fill = value;
    return;
  }
  throw new Error(`unsupported host inject action "${inject.action}"`);
}

function recordForbidden(flags: SandboxFlags, detail: string): void {
  flags.forbiddenApis.push(detail);
}

function forbiddenFunction(flags: SandboxFlags, kind: string): unknown {
  // The proxy target must be constructable. An arrow function makes `new Function`
  // throw before the construct trap, so the attempt is swallowed by user try/catch.
  function trap(this: unknown, ...args: unknown[]): never {
    recordForbidden(flags, `${kind}(${args.map((arg) => String(arg).slice(0, 80)).join(",")})`);
    throw new Error(`forbidden api: ${kind}`);
  }
  return new Proxy(trap, {
    apply(_target, _thisArg, args: unknown[]) {
      return trap(...args);
    },
    construct(_target, args: unknown[]) {
      recordForbidden(flags, `${kind}.construct(${args.map((arg) => String(arg).slice(0, 80)).join(",")})`);
      throw new Error(`forbidden api: ${kind}`);
    },
  });
}

function methodStub(flags: SandboxFlags, moduleName: string): unknown {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      return (...args: unknown[]) => {
        recordForbidden(
          flags,
          `${moduleName}.${String(prop)}(${args.map((arg) => String(arg).slice(0, 80)).join(",")})`,
        );
        throw new Error(`forbidden api: ${moduleName}.${String(prop)}`);
      };
    },
  });
}

export interface FreeExecOptions {
  driver?: EvalDriver;
  code?: string;
  schemaViolation?: string;
  tokenUsage?: TokenUsage | null;
  latencyMs?: number;
  loopRepeat?: boolean;
  contextOverflow?: boolean;
}

export function runFreeExecTask(task: EvalTask, options: FreeExecOptions = {}): EvalTaskResult {
  const driver = options.driver ?? "deterministic-harness";
  const started = performance.now();
  const initial = freshDocument(task.preset);
  const raw = freshDocument(task.preset);
  const trace = emptyTrace();
  if (options.schemaViolation !== undefined) {
    trace.schemaViolation = true;
    trace.errorMessage = options.schemaViolation;
  } else if (options.contextOverflow === true) {
    trace.contextOverflow = true;
    trace.errorMessage = "context overflow";
  } else {
    const code = options.code ?? task.baselineCode;
    const executed = executeBaseline(task, raw, code);
    trace.issueCodes = executed.issueCodes;
    trace.forbiddenApis = executed.forbiddenApis;
    trace.pollutionAttempts = executed.pollutionAttempts;
    trace.wroteWhileDrifted = executed.wroteWhileDrifted;
    trace.userMutated = executed.userMutated;
    trace.threw = executed.threw;
    trace.rolledBack = executed.rolledBack;
    trace.syncedDrift = executed.syncedDrift;
    if (executed.errorMessage !== undefined) trace.errorMessage = executed.errorMessage;
  }
  if (options.loopRepeat === true) trace.loopRepeat = true;
  const latencyMs = options.latencyMs ?? performance.now() - started;
  return finishTask({
    task,
    policy: "free-exec",
    driver,
    initial,
    finalDocument: raw,
    trace,
    latencyMs,
    tokenUsage: options.tokenUsage ?? null,
  });
}

function executeBaseline(task: EvalTask, raw: EvalDocument, code: string): ExecutionTrace {
  const flags: SandboxFlags = {
    issueCodes: [],
    forbiddenApis: [],
    pollutionAttempts: [],
    wroteWhileDrifted: false,
    userMutated: false,
    rolledBack: false,
    syncedDrift: false,
    drifted: false,
    injected: false,
    internal: false,
  };
  const history: HistoryEntry[] = [];
  const proxyToRaw = new WeakMap<object, object>();
  const rawToProxy = new WeakMap<object, object>();
  const inert = Object.create(null) as object;

  function unwrap(value: unknown): unknown {
    if (value !== null && typeof value === "object" && proxyToRaw.has(value)) return proxyToRaw.get(value);
    return value;
  }

  function notePollution(detail: string): void {
    flags.pollutionAttempts.push(detail);
  }

  function maybeTrigger(id: string | undefined, key: string, value: unknown): void {
    const trigger = task.hostInject?.trigger;
    if (!trigger || flags.injected || flags.internal || !id) return;
    if (trigger.id !== id || trigger.property !== key || !sameJson(value as Json, trigger.equals)) return;
    flags.internal = true;
    try {
      applyInject(raw, task.hostInject!);
    } finally {
      flags.internal = false;
    }
    flags.injected = true;
    flags.drifted = true;
  }

  function wrap(value: unknown, kind: string, id?: string): unknown {
    if (value === null || typeof value !== "object") return value;
    const existing = rawToProxy.get(value);
    if (existing) return existing;
    const proxy = new Proxy(value, {
      get(target, prop, receiver) {
        if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
        const key = String(prop);
        if (MAGIC_KEYS.has(key)) {
          notePollution(`get ${kind}.${key}`);
          return inert;
        }
        const child = Reflect.get(target, prop, receiver);
        if (typeof child === "function") {
          if (key === "push" && Array.isArray(target)) {
            return (...items: unknown[]) => {
              if (!flags.internal) flags.userMutated = true;
              return target.push(...items.map((item) => unwrap(item)));
            };
          }
          return child.bind(target);
        }
        if (kind === "root" && key === "meta") return wrap(child, "meta");
        if (kind === "root" && key === "objects") return wrap(child, "array");
        if (kind === "object" && key === "properties") return wrap(child, "properties", id);
        if (kind === "array" && child !== null && typeof child === "object") {
          const childId =
            child !== null && typeof child === "object" && typeof (child as { id?: unknown }).id === "string"
              ? (child as { id: string }).id
              : undefined;
          return wrap(child, "object", childId);
        }
        return child;
      },
      set(target, prop, newValue) {
        const key = String(prop);
        if (MAGIC_KEYS.has(key)) {
          notePollution(`set ${kind}.${key}`);
          if (flags.drifted && !flags.internal) flags.wroteWhileDrifted = true;
          return true;
        }
        if (!flags.internal) {
          if (flags.drifted) flags.wroteWhileDrifted = true;
          flags.userMutated = true;
          if (kind === "properties" && id) {
            const previous = (target as Record<string, unknown>)[key];
            history.push({
              id,
              key,
              value: previous === undefined ? undefined : structuredClone(previous),
            });
          }
          if (kind === "root" && !new Set(["objects", "selection", "meta"]).has(key)) {
            notePollution(`root.${key}`);
          }
          if (kind === "object" && !new Set(["id", "type", "parent", "properties"]).has(key)) {
            notePollution(`${id ?? kind}.${key}`);
          }
          if (kind === "meta" && key !== "activeSlide") notePollution(`meta.${key}`);
        }
        const stored = unwrap(newValue);
        const ok = Reflect.set(target, prop, stored);
        if (!flags.internal) maybeTrigger(kind === "properties" ? id : undefined, key, stored);
        return ok;
      },
      deleteProperty(target, prop) {
        if (!flags.internal) {
          flags.userMutated = true;
          if (flags.drifted) flags.wroteWhileDrifted = true;
        }
        return Reflect.deleteProperty(target, prop);
      },
      getPrototypeOf() {
        return null;
      },
    });
    rawToProxy.set(value, proxy);
    proxyToRaw.set(proxy, value);
    return proxy;
  }

  if (task.hostInject && !task.hostInject.trigger) {
    flags.internal = true;
    try {
      applyInject(raw, task.hostInject);
    } finally {
      flags.internal = false;
    }
    flags.injected = true;
    flags.drifted = true;
  }

  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const envProxy = new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      recordForbidden(flags, `process.env.${String(prop)}`);
      throw new Error("forbidden api: process.env");
    },
  });
  const processProxy = new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (prop === "env") {
        recordForbidden(flags, "process.env");
        return envProxy;
      }
      recordForbidden(flags, `process.${String(prop)}`);
      throw new Error("forbidden api: process");
    },
  });
  const requireFn = (id: unknown) => {
    const name = String(id);
    recordForbidden(flags, `require(${name})`);
    if (name === "fs" || name === "node:fs" || name === "child_process" || name === "node:child_process") {
      return methodStub(flags, name);
    }
    throw new Error(`forbidden api: require(${name})`);
  };
  Object.assign(context, {
    state: wrap(raw, "root"),
    find: (id: unknown) => {
      const object = raw.objects.find((item) => item.id === String(id));
      return object ? wrap(object, "object", object.id) : undefined;
    },
    sync: () => {
      flags.issueCodes.push("sync");
      if (!flags.drifted) return false;
      flags.drifted = false;
      flags.syncedDrift = true;
      return true;
    },
    undo: () => {
      const entry = history.pop();
      if (!entry) {
        flags.issueCodes.push("nothing_to_undo");
        return false;
      }
      const object = raw.objects.find((item) => item.id === entry.id);
      if (!object) return false;
      flags.internal = true;
      try {
        if (entry.value === undefined) delete object.properties[entry.key];
        else object.properties[entry.key] = entry.value as Json;
      } finally {
        flags.internal = false;
      }
      return true;
    },
    hostDiverged: () => {
      if (flags.drifted) flags.issueCodes.push("host_diverged");
      return flags.drifted;
    },
    require: requireFn,
    process: processProxy,
    eval: forbiddenFunction(flags, "eval"),
    Function: forbiddenFunction(flags, "Function"),
    fetch: forbiddenFunction(flags, "fetch"),
    fs: methodStub(flags, "fs"),
    console: { log() {}, warn() {}, error() {} },
  });

  const trace = emptyTrace();
  trace.issueCodes = flags.issueCodes;
  trace.forbiddenApis = flags.forbiddenApis;
  trace.pollutionAttempts = flags.pollutionAttempts;
  try {
    vm.runInContext(`"use strict";\n((Function) => {\n${code}\n})(globalThis.Function);\n`, context, { timeout: 1000 });
  } catch (error) {
    trace.threw = true;
    trace.errorMessage = error instanceof Error ? error.message : String(error);
    if (error instanceof SyntaxError) trace.schemaViolation = true;
  }
  trace.wroteWhileDrifted = flags.wroteWhileDrifted;
  trace.userMutated = flags.userMutated;
  trace.rolledBack = flags.rolledBack;
  trace.syncedDrift = flags.syncedDrift;
  return trace;
}
