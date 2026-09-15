import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KritaAdapter, Session, runConformance } from "../src/index.js";
import { killProcessTree, pidAlive } from "../src/adapters/host-rpc.js";

const available = KritaAdapter.available();

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

function spawnCanary(): ChildProcess {
  return spawn("ping", ["-t", "127.0.0.1"], { windowsHide: true, stdio: "ignore" });
}

describe("Krita availability", () => {
  it("reports whether krita.exe and the PyKrita bridge are present", () => {
    expect(typeof available).toBe("boolean");
  });
});

describe.skipIf(!available)("Krita", () => {
  let adapter: KritaAdapter;
  let canary: ChildProcess | undefined;

  beforeAll(() => {
    canary = spawnCanary();
    adapter = new KritaAdapter({ seed: true });
  }, 180_000);

  afterEach(() => {
    adapter.reset();
  }, 90_000);

  afterAll(() => {
    const pid = adapter.processId();
    adapter.close();
    if (pid) expect(pidAlive(pid)).toBe(false);
    if (canary?.pid) {
      expect(pidAlive(canary.pid)).toBe(true);
      killProcessTree(canary.pid);
    }
  }, 30_000);

  it("reads structured state from the seeded document", () => {
    const session = new Session(adapter);
    expect(session.describe().capabilities.snapshotRestore).toBe(true);
    expect(object(session, "document_01")?.type).toBe("document");
    expect(object(session, "paint_01")?.type).toBe("layer");
    expect(object(session, "lock_01")?.properties.locked).toBe(true);
    expect(session.snapshot().meta?.restoreScope).toBe("exposed-state");
  }, 60_000);

  it("sets opacity on a live layer and reports effects", () => {
    const session = new Session(adapter);
    const result = session.apply({ action: "set_opacity", target: "paint_01", value: 40 });
    expect(result.status).toBe("accepted");
    expect(result.effects.some((effect) => effect.path?.includes("opacity"))).toBe(true);
    expect(object(session, "paint_01")?.properties.opacity).toBe(40);
  }, 60_000);

  it("hides a live layer", () => {
    const session = new Session(adapter);
    const result = session.apply({ action: "set_visible", target: "paint_01", value: false });
    expect(result.status).toBe("accepted");
    expect(object(session, "paint_01")?.properties.visible).toBe(false);
  }, 60_000);

  it("creates a paint layer on the live document", () => {
    const session = new Session(adapter);
    const result = session.apply({
      action: "create_layer",
      params: { kind: "paint", id: "paint_live" },
    });
    expect(result.status).toBe("accepted");
    expect(object(session, "paint_live")?.parent).toBe("document_01");
  }, 60_000);

  it("rejects set_opacity on a locked layer before PyKrita mutates", () => {
    const session = new Session(adapter);
    const before = object(session, "lock_01")?.properties.opacity;
    const result = session.apply({ action: "set_opacity", target: "lock_01", value: 40 });
    expect(result.status).toBe("rejected");
    expect(result.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(object(session, "lock_01")?.properties.opacity).toBe(before);
  }, 60_000);

  it("undoes an opacity change by compensation", () => {
    const session = new Session(adapter);
    const before = object(session, "paint_01")?.properties.opacity;
    session.apply({ action: "set_opacity", target: "paint_01", value: 25 });
    const undone = session.undo();
    expect(undone.status).toBe("accepted");
    expect(undone.recovery).toBe("compensation");
    expect(object(session, "paint_01")?.properties.opacity).toBe(before);
  }, 60_000);

  it("restores the exposed layer graph, not pixel contents", () => {
    const session = new Session(adapter);
    session.apply({ action: "set_opacity", target: "paint_01", value: 10 });
    const rolled = session.rollback(0);
    expect(rolled.status).toBe("accepted");
    expect(object(session, "paint_01")?.properties.opacity).toBe(100);
  }, 60_000);

  it("rejects further IR actions when Krita changed out of band", () => {
    const session = new Session(adapter);
    adapter.execute(
      { action: "set_opacity", target: "paint_01", params: { value: 55 } },
      session.snapshot(),
    );
    const blocked = session.apply({ action: "set_visible", target: "paint_01", value: false });
    expect(blocked.status).toBe("rejected");
    expect(blocked.issues?.[0]?.code).toBe("host_diverged");
    const synced = session.sync();
    expect(synced.status).toBe("accepted");
    const after = session.apply({ action: "set_opacity", target: "paint_01", value: 80 });
    expect(after.status).toBe("accepted");
  }, 60_000);
});

describe.skipIf(!available)("Krita .kra round-trip", () => {
  it("keeps edited opacity after save, close, and reopen", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scir-krita-doc-"));
    const document = path.join(dir, "board.kra");
    const first = new KritaAdapter({ seed: true });
    const firstPid = first.processId();
    try {
      const session = new Session(first);
      const changed = session.apply({ action: "set_opacity", target: "paint_01", value: 35 });
      expect(changed.status).toBe("accepted");
      first.save(document);
    } finally {
      first.close();
    }
    if (firstPid) expect(pidAlive(firstPid)).toBe(false);

    const second = new KritaAdapter({ document });
    const secondPid = second.processId();
    try {
      const session = new Session(second);
      expect(object(session, "paint_01")?.properties.opacity).toBe(35);
    } finally {
      second.close();
    }
    if (secondPid) expect(pidAlive(secondPid)).toBe(false);
  }, 240_000);
});

describe.skipIf(!available)("Krita conformance", () => {
  it("passes the v0 checks against a live Krita document", () => {
    const adapter = new KritaAdapter({ seed: true });
    try {
      const failed = runConformance(adapter).filter((check) => !check.ok);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    } finally {
      adapter.close();
    }
  }, 180_000);
});
