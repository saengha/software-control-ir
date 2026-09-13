import { describe, expect, it } from "vitest";
import { LabAdapter, Session, SlidesAdapter } from "../src/index.js";

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

describe("atomic batches", () => {
  it("commits a batch that fully validates", () => {
    const session = new Session(new SlidesAdapter());
    const result = session.transaction([
      { action: "set_text", target: "title_01", value: "Rebranded" },
      { action: "set_fill", target: "accent_01", value: "#2f6f5f" },
    ]);

    expect(result.status).toBe("accepted");
    expect(result.rolledBack).toBe(false);
    expect(result.revision).toBe(2);
    expect(result.effects.length).toBeGreaterThan(1);
    expect(object(session, "title_01")?.properties.text).toBe("Rebranded");
  });

  it("reverts the accepted prefix when a later action is rejected", () => {
    const session = new Session(new SlidesAdapter());
    const result = session.transaction([
      { action: "set_text", target: "title_01", value: "Rebranded" },
      { action: "set_fill", target: "logo_01", value: "#2f6f5f" },
    ]);

    expect(result.status).toBe("rejected");
    expect(result.rolledBack).toBe(true);
    expect(result.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(session.snapshot().revision).toBe(0);
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
  });

  it("keeps a batch from resuming past the failing action", () => {
    const session = new Session(new SlidesAdapter());
    const result = session.transaction([
      { action: "set_fill", target: "accent_01", value: "not-a-color" },
      { action: "set_text", target: "title_01", value: "Never applied" },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.rolledBack).toBe(false);
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
  });
});

describe("undo", () => {
  it("undoes a property change with an inverse action and keeps history forward", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_text", target: "title_01", value: "Board Update" });
    const undone = session.undo();

    expect(undone.status).toBe("accepted");
    expect(undone.recovery).toBe("compensation");
    expect(undone.revision).toBe(2);
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
    expect(session.history()).toHaveLength(2);
  });

  it("falls back to a snapshot restore when no inverse action exists", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "delete", target: "accent_01" });
    const undone = session.undo();

    expect(undone.recovery).toBe("snapshot");
    expect(undone.revision).toBe(0);
    expect(object(session, "accent_01")).toBeTruthy();
  });

  it("rejects undo at revision 0", () => {
    const session = new Session(new LabAdapter());
    const undone = session.undo();
    expect(undone.status).toBe("rejected");
    expect(undone.issues?.[0]?.code).toBe("nothing_to_undo");
  });

  it("compensates a lab temperature change", () => {
    const session = new Session(new LabAdapter());
    session.apply({ action: "set_temperature", target: "heater_01", value: 300 });
    const undone = session.undo();

    expect(undone.recovery).toBe("compensation");
    expect(object(session, "heater_01")?.properties.temperature).toBe(120);
  });

  it("accepts undo as an action name", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_text", target: "title_01", value: "Typo" });
    const undone = session.apply({ action: "undo" });
    expect(undone.status).toBe("accepted");
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
  });
});
