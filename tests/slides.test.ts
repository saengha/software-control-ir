import { describe, expect, it } from "vitest";
import { replay, Session, SlidesAdapter } from "../src/index.js";

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

describe("slides adapter", () => {
  it("creates a shape on the active slide and reports the effect", () => {
    const session = new Session(new SlidesAdapter());
    const result = session.apply({
      action: "create_shape",
      kind: "rectangle",
      x: 120,
      y: 240,
      width: 200,
      height: 80,
      id: "box_01",
    });

    expect(result.status).toBe("accepted");
    expect(result.effects.some((effect) => effect.kind === "create" && effect.target === "box_01")).toBe(true);
    expect(object(session, "box_01")?.parent).toBe("slide_01");
    expect(object(session, "box_01")?.type).toBe("rectangle");
  });

  it("keeps relevant state on the active slide", () => {
    const session = new Session(new SlidesAdapter());
    const ids = session.relevant().objects.map((item) => item.id);
    expect(ids).toContain("slide_01");
    expect(ids).toContain("title_01");
    expect(ids).not.toContain("body_02");
  });

  it("rejects locked fills and deleting a slide that still has shapes", () => {
    const session = new Session(new SlidesAdapter());
    const locked = session.apply({ action: "set_fill", target: "logo_01", value: "#ff0000" });
    const blocked = session.apply({ action: "delete", target: "slide_01" });

    expect(locked.status).toBe("rejected");
    expect(locked.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(blocked.issues?.some((issue) => issue.code === "has_children")).toBe(true);
    expect(object(session, "logo_01")?.properties.fill).toBe("#8fd0c4");
    expect(object(session, "slide_01")).toBeTruthy();
  });

  it("sets text, aligns, and rolls back", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_text", target: "title_01", value: "Board Deck" });
    session.apply({ action: "align", target: "accent_01", edge: "center" });
    expect(object(session, "title_01")?.properties.text).toBe("Board Deck");
    expect(object(session, "accent_01")?.properties.x).toBe(360);

    const rolled = session.rollback(0);
    expect(rolled.status).toBe("accepted");
    expect(object(session, "title_01")?.properties.text).toBe("Quarterly Review");
    expect(object(session, "accent_01")?.properties.x).toBe(80);
  });

  it("switches the relevant slice with the active slide", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_active_slide", target: "slide_02" });
    const ids = session.relevant().objects.map((item) => item.id);
    expect(ids).toContain("slide_02");
    expect(ids).toContain("body_02");
    expect(ids).not.toContain("title_01");
  });

  it("duplicates a shape and raises z-order", () => {
    const session = new Session(new SlidesAdapter());
    const duplicated = session.apply({ action: "duplicate", target: "accent_01" });
    const front = session.apply({ action: "bring_to_front", target: "accent_01_copy" });

    expect(duplicated.status).toBe("accepted");
    expect(object(session, "accent_01_copy")?.parent).toBe("slide_01");
    expect(object(session, "accent_01_copy")?.properties.x).toBe(104);
    expect(front.status).toBe("accepted");
    expect(object(session, "accent_01_copy")?.properties.z).toBeGreaterThan(
      Number(object(session, "accent_01")?.properties.z),
    );
  });

  it("replays an accepted trace onto a fresh adapter", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_text", target: "title_01", value: "Replay" });
    const replayed = replay(() => new SlidesAdapter(), session.exportTrace());
    expect(object(replayed, "title_01")?.properties.text).toBe("Replay");
    expect(replayed.snapshot().revision).toBe(1);
  });
});
