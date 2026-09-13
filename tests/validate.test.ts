import { describe, expect, it } from "vitest";
import { LabAdapter, normalizeAction, Session } from "../src/index.js";

describe("action normalization and validation", () => {
  it("accepts the flattened manifesto action shape", () => {
    expect(
      normalizeAction({
        action: "set_temperature",
        target: "heater_01",
        value: 150,
      }),
    ).toEqual({
      action: "set_temperature",
      target: "heater_01",
      params: { value: 150 },
    });
  });

  it("does not execute unknown operations", () => {
    const session = new Session(new LabAdapter());
    const result = session.apply({ action: "explode", target: "heater_01" });
    expect(result.status).toBe("rejected");
    expect(result.issues?.[0]?.code).toBe("unknown_operation");
  });

  it("rejects create when the id already exists", () => {
    const session = new Session(new LabAdapter());
    const result = session.apply({
      action: "create",
      params: { id: "heater_01", type: "heater", x: 20, y: 20 },
    });
    expect(result.status).toBe("rejected");
    expect(result.issues?.some((issue) => issue.code === "duplicate_target")).toBe(true);
  });

  it("rejects an enum value that the catalog does not allow", () => {
    const session = new Session(new LabAdapter());
    const result = session.apply({
      action: "create",
      params: { id: "pump_01", type: "pump", x: 20, y: 20 },
    });
    expect(result.status).toBe("rejected");
    expect(result.issues?.some((issue) => issue.code === "invalid_params")).toBe(true);
  });
});
