import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BlenderAdapter, blenderProgram, Session, runConformance } from "../src/index.js";
import { killProcessTree, pidAlive } from "../src/adapters/host-rpc.js";

const available = BlenderAdapter.available();

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

function spawnCanary(): ChildProcess {
  return spawn("ping", ["-t", "127.0.0.1"], { windowsHide: true, stdio: "ignore" });
}

describe("Blender availability", () => {
  it("reports whether blender.exe and the bpy bridge are present", () => {
    expect(typeof available).toBe("boolean");
    if (available) {
      console.log(`LIVE_HOST=blender ${blenderProgram()}`);
    } else {
      console.log("LIVE_HOST=skipped blender.exe not found (set SCIR_BLENDER)");
    }
  });
});

describe.skipIf(!available)("Blender live smoke", () => {
  it("set_location is visible in a fresh bpy snapshot, not only in ActionResult", () => {
    const adapter = new BlenderAdapter({ seed: true });
    const pid = adapter.processId();
    try {
      expect(pid, "real blender.exe process").toBeTypeOf("number");
      expect(pidAlive(pid!)).toBe(true);

      const before = adapter.snapshot().objects.find((item) => item.id === "cube_01");
      expect(before?.type).toBe("mesh");
      expect(before?.properties.location).not.toEqual([1, 2, 3]);

      const session = new Session(adapter);
      const result = session.apply({ action: "set_location", target: "cube_01", x: 1, y: 2, z: 3 });
      expect(result.status).toBe("accepted");

      const host = adapter.snapshot().objects.find((item) => item.id === "cube_01");
      expect(host?.properties.location).toEqual([1, 2, 3]);
      expect(host?.properties.location).not.toEqual(before?.properties.location);
    } finally {
      adapter.close();
    }
    expect(pidAlive(pid!), "blender process tree stopped").toBe(false);
  }, 120_000);
});

describe.skipIf(!available)("Blender", () => {
  let adapter: BlenderAdapter;
  let canary: ChildProcess | undefined;

  beforeAll(() => {
    canary = spawnCanary();
    adapter = new BlenderAdapter({ seed: true });
  }, 120_000);

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

  it("reads structured state from the seeded scene", () => {
    const session = new Session(adapter);
    expect(session.describe().capabilities.snapshotRestore).toBe(true);
    expect(object(session, "cube_01")?.type).toBe("mesh");
    expect(object(session, "lock_01")?.properties.locked).toBe(true);
    expect(object(session, "light_01")?.type).toBe("light");
    expect(object(session, "extra_01")?.parent).toBe("scene_02");
    expect(session.snapshot().meta?.units).toBe("m");
    expect(session.snapshot().meta?.restoreScope).toBe("exposed-state");
  }, 60_000);

  it("moves a live object and reports effects", () => {
    const session = new Session(adapter);
    const result = session.apply({ action: "set_location", target: "cube_01", x: 1.25, y: 0, z: 0 });
    expect(result.status).toBe("accepted");
    expect(result.effects.some((effect) => effect.path?.includes("location"))).toBe(true);
    expect(object(session, "cube_01")?.properties.location).toEqual([1.25, 0, 0]);
  }, 60_000);

  it("scales a live object", () => {
    const session = new Session(adapter);
    const result = session.apply({ action: "set_scale", target: "cube_01", x: 2, y: 2, z: 2 });
    expect(result.status).toBe("accepted");
    expect(object(session, "cube_01")?.properties.scale).toEqual([2, 2, 2]);
  }, 60_000);

  it("creates an object on the live scene", () => {
    const session = new Session(adapter);
    const result = session.apply({
      action: "create_object",
      params: { kind: "mesh", x: 3, y: 0, z: 0, id: "mesh_live" },
    });
    expect(result.status).toBe("accepted");
    expect(object(session, "mesh_live")?.parent).toBe("scene_01");
  }, 60_000);

  it("rejects a location change on a locked object before bpy mutates", () => {
    const session = new Session(adapter);
    const before = object(session, "lock_01")?.properties.location;
    const result = session.apply({ action: "set_location", target: "lock_01", x: 9, y: 0, z: 0 });
    expect(result.status).toBe("rejected");
    expect(result.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(object(session, "lock_01")?.properties.location).toEqual(before);
  }, 60_000);

  it("hides extra_01 from relevant state while cube_01 is selected", () => {
    const session = new Session(adapter);
    const ids = session.relevant().objects.map((item) => item.id);
    expect(ids).toContain("cube_01");
    expect(ids).not.toContain("extra_01");
  }, 60_000);

  it("undoes a location change by compensation", () => {
    const session = new Session(adapter);
    const before = object(session, "cube_01")?.properties.location;
    session.apply({ action: "set_location", target: "cube_01", x: 2, y: 0, z: 0 });
    const undone = session.undo();
    expect(undone.status).toBe("accepted");
    expect(undone.recovery).toBe("compensation");
    expect(object(session, "cube_01")?.properties.location).toEqual(before);
  }, 60_000);

  it("restores exposed IR state, not a full mesh rollback claim", () => {
    const session = new Session(adapter);
    session.apply({ action: "set_location", target: "cube_01", x: 2, y: 0, z: 0 });
    const rolled = session.rollback(0);
    expect(rolled.status).toBe("accepted");
    expect(object(session, "cube_01")?.properties.location).toEqual([0, 0, 0]);
  }, 60_000);

  it("rejects further IR actions when Blender changed out of band", () => {
    const session = new Session(adapter);
    adapter.execute(
      { action: "set_location", target: "cube_01", params: { x: 7, y: 0, z: 0 } },
      session.snapshot(),
    );
    const blocked = session.apply({ action: "set_scale", target: "cube_01", x: 1, y: 1, z: 1 });
    expect(blocked.status).toBe("rejected");
    expect(blocked.issues?.[0]?.code).toBe("host_diverged");
    const synced = session.sync();
    expect(synced.status).toBe("accepted");
    const after = session.apply({ action: "set_location", target: "cube_01", x: 0.5, y: 0, z: 0 });
    expect(after.status).toBe("accepted");
  }, 60_000);
});

describe.skipIf(!available)("Blender .blend round-trip", () => {
  it("keeps edited location after save, close, and reopen", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scir-blend-doc-"));
    const document = path.join(dir, "scene.blend");
    const first = new BlenderAdapter({ seed: true });
    const firstPid = first.processId();
    try {
      const session = new Session(first);
      const changed = session.apply({ action: "set_location", target: "cube_01", x: 1.5, y: 0, z: 0 });
      expect(changed.status).toBe("accepted");
      first.save(document);
    } finally {
      first.close();
    }
    if (firstPid) expect(pidAlive(firstPid)).toBe(false);

    const second = new BlenderAdapter({ document });
    const secondPid = second.processId();
    try {
      const session = new Session(second);
      expect(object(session, "cube_01")?.properties.location).toEqual([1.5, 0, 0]);
    } finally {
      second.close();
    }
    if (secondPid) expect(pidAlive(secondPid)).toBe(false);
  }, 180_000);
});

describe.skipIf(!available)("Blender conformance", () => {
  it("passes the v0 checks against a live Blender scene", () => {
    const adapter = new BlenderAdapter({ seed: true });
    try {
      const failed = runConformance(adapter).filter((check) => !check.ok);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    } finally {
      adapter.close();
    }
  }, 180_000);
});
