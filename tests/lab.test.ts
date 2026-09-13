import { describe, expect, it } from "vitest";
import { formatAgentView, LabAdapter, Session } from "../src/index.js";

function heater(session: Session, id: string) {
  return session.snapshot().objects.find((object) => object.id === id);
}

describe("lab adapter session", () => {
  it("applies the manifesto temperature example and reports the effect", () => {
    const session = new Session(new LabAdapter());
    const result = session.apply({
      action: "set_temperature",
      target: "heater_01",
      value: 150,
    });

    expect(result.status).toBe("accepted");
    expect(result.revision).toBe(1);
    expect(result.focus?.before?.properties.temperature).toBe(120);
    expect(result.focus?.after?.properties.temperature).toBe(150);
    expect(result.effects).toContainEqual({
      kind: "update",
      target: "heater_01",
      path: "properties.temperature",
      from: 120,
      to: 150,
    });
    expect(heater(session, "heater_01")?.properties.temperature).toBe(150);
  });

  it("rejects a locked target before mutating", () => {
    const session = new Session(new LabAdapter());
    const result = session.apply({
      action: "set_temperature",
      target: "heater_02",
      params: { value: 150 },
    });

    expect(result.status).toBe("rejected");
    expect(result.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(session.snapshot().revision).toBe(0);
    expect(heater(session, "heater_02")?.properties.temperature).toBe(80);
  });

  it("rejects an unknown target and an out-of-range value", () => {
    const session = new Session(new LabAdapter());
    const missing = session.apply({
      action: "set_temperature",
      target: "heater_99",
      params: { value: 150 },
    });
    const range = session.apply({
      action: "set_temperature",
      target: "heater_01",
      params: { value: 900 },
    });

    expect(missing.issues?.some((issue) => issue.code === "unknown_target")).toBe(true);
    expect(range.issues?.some((issue) => issue.code === "invalid_params")).toBe(true);
    expect(heater(session, "heater_01")?.properties.temperature).toBe(120);
  });

  it("rolls back to a previous revision", () => {
    const session = new Session(new LabAdapter());
    session.apply({ action: "set_temperature", target: "heater_01", params: { value: 150 } });
    session.apply({ action: "move", target: "heater_01", params: { x: 10, y: 20 } });
    expect(session.snapshot().revision).toBe(2);

    const rolled = session.rollback(0);
    expect(rolled.status).toBe("accepted");
    expect(session.snapshot().revision).toBe(0);
    expect(heater(session, "heater_01")?.properties.temperature).toBe(120);
    expect(heater(session, "heater_01")?.properties.position).toEqual([140, 170]);
    expect(session.history()).toEqual([]);
  });

  it("formats a compact agent view from state and catalog", () => {
    const session = new Session(new LabAdapter());
    const view = formatAgentView(session.snapshot(), session.catalog());
    expect(view).toContain("heater_01");
    expect(view).toContain("set_temperature");
    expect(view).toContain("revision 0");
  });
});
