import { describe, expect, it } from "vitest";
import {
  hostOwned,
  LabAdapter,
  Session,
  type Action,
  type Adapter,
  type AdapterState,
  type ExecuteOutcome,
  type State,
  type StateQuery,
} from "../src/index.js";

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

class ExplodingLab implements Adapter {
  private readonly inner = new LabAdapter();
  readonly id = "lab";
  readonly domain = "lab-scene";
  catalog() {
    return this.inner.catalog();
  }
  snapshot(query?: StateQuery) {
    return this.inner.snapshot(query);
  }
  check(action: Action, state: State) {
    return this.inner.check(action, state);
  }
  execute(action: Action, state: State): ExecuteOutcome {
    this.inner.execute(action, state);
    throw new Error("native API exploded after mutating");
  }
  restore(state: AdapterState) {
    this.inner.restore(state);
  }
  inverse(action: Action, before: State) {
    return this.inner.inverse(action, before);
  }
  fixtures() {
    return this.inner.fixtures();
  }
  capabilities() {
    return { snapshotRestore: false as const };
  }
}

describe("expected revision", () => {
  it("keeps expectedRevision off the params object", () => {
    const session = new Session(new LabAdapter());
    const result = session.apply({
      action: "set_temperature",
      target: "heater_01",
      value: 150,
      expectedRevision: 0,
    });
    expect(result.status).toBe("accepted");
    expect(result.action.expectedRevision).toBe(0);
    expect(result.action.params.expectedRevision).toBeUndefined();
  });

  it("rejects an action planned against an older revision", () => {
    const session = new Session(new LabAdapter());
    session.apply({ action: "set_temperature", target: "heater_01", value: 150 });
    const result = session.apply({
      action: "set_temperature",
      target: "heater_01",
      value: 180,
      expectedRevision: 0,
    });
    expect(result.status).toBe("rejected");
    expect(result.issues?.[0]?.code).toBe("stale_revision");
    expect(object(session, "heater_01")?.properties.temperature).toBe(150);
  });
});

describe("host-owned documents", () => {
  it("declares that snapshot restore is not available", () => {
    const session = new Session(hostOwned(new LabAdapter()));
    expect(session.describe().capabilities).toMatchObject({
      snapshotRestore: false,
      compensation: true,
      transactions: true,
    });
  });

  it("rejects rollback instead of overwriting the host", () => {
    const session = new Session(hostOwned(new LabAdapter()));
    session.apply({ action: "set_temperature", target: "heater_01", value: 150 });
    const rolled = session.rollback(0);
    expect(rolled.status).toBe("rejected");
    expect(rolled.issues?.[0]?.code).toBe("unsupported_recovery");
    expect(object(session, "heater_01")?.properties.temperature).toBe(150);
  });

  it("undoes with an inverse action and leaves history moving forward", () => {
    const session = new Session(hostOwned(new LabAdapter()));
    session.apply({ action: "set_temperature", target: "heater_01", value: 150 });
    const undone = session.undo();
    expect(undone.status).toBe("accepted");
    expect(undone.recovery).toBe("compensation");
    expect(undone.revision).toBe(2);
    expect(object(session, "heater_01")?.properties.temperature).toBe(120);
  });

  it("refuses undo when the adapter has no inverse and no snapshot", () => {
    const session = new Session(hostOwned(new LabAdapter()));
    session.apply({ action: "delete", target: "vessel_01" });
    const undone = session.undo();
    expect(undone.status).toBe("rejected");
    expect(undone.issues?.[0]?.code).toBe("unsupported_recovery");
    expect(object(session, "vessel_01")).toBeUndefined();
  });

  it("reverts an aborted batch with inverse actions, not a snapshot", () => {
    const session = new Session(hostOwned(new LabAdapter()));
    const outcome = session.transaction([
      { action: "set_temperature", target: "heater_01", value: 150 },
      { action: "set_temperature", target: "heater_02", value: 200 },
    ]);
    expect(outcome.status).toBe("rejected");
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.recovery).toBe("compensation");
    expect(outcome.revision).toBeGreaterThan(0);
    expect(object(session, "heater_01")?.properties.temperature).toBe(120);
  });

  it("admits dirty state when a batch prefix cannot be inverted", () => {
    const session = new Session(hostOwned(new LabAdapter()));
    const outcome = session.transaction([
      { action: "delete", target: "vessel_01" },
      { action: "set_temperature", target: "heater_02", value: 200 },
    ]);
    expect(outcome.status).toBe("failed");
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.issues?.some((issue) => issue.code === "dirty_state")).toBe(true);
    expect(object(session, "vessel_01")).toBeUndefined();
  });

  it("rejects further actions until the session syncs a host edit", () => {
    const lab = new LabAdapter();
    const session = new Session(lab);
    lab.execute(
      { action: "set_temperature", target: "heater_01", params: { value: 200 } },
      session.snapshot(),
    );

    const blocked = session.apply({ action: "set_level", target: "vessel_01", value: 10 });
    expect(blocked.issues?.[0]?.code).toBe("host_diverged");
    expect(object(session, "heater_01")?.properties.temperature).toBe(200);

    const synced = session.sync();
    expect(synced.status).toBe("accepted");
    expect(synced.revision).toBe(1);
    expect(synced.effects.some((effect) => effect.path?.includes("temperature"))).toBe(true);

    const after = session.apply({
      action: "set_level",
      target: "vessel_01",
      value: 10,
      expectedRevision: 1,
    });
    expect(after.status).toBe("accepted");
  });

  it("does not call restore when a native execute throws, and reports the leftover mutation", () => {
    const session = new Session(new ExplodingLab());
    const result = session.apply({ action: "set_temperature", target: "heater_01", value: 150 });
    expect(result.status).toBe("failed");
    expect(result.issues?.map((issue) => issue.code)).toEqual(["execution_failed", "dirty_state"]);
    expect(object(session, "heater_01")?.properties.temperature).toBe(150);
  });
});
