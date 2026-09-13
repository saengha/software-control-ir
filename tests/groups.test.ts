import { describe, expect, it } from "vitest";
import { boxOf, Session, SlidesAdapter } from "../src/index.js";

function object(session: Session, id: string) {
  return session.snapshot().objects.find((item) => item.id === id);
}

describe("slide groups", () => {
  it("groups two shapes into a bounding box and reparents them", () => {
    const session = new Session(new SlidesAdapter());
    const result = session.apply({ action: "group", ids: ["title_01", "accent_01"], id: "band_01" });

    expect(result.status).toBe("accepted");
    const group = object(session, "band_01")!;
    expect(group.type).toBe("group");
    expect(group.parent).toBe("slide_01");
    expect(boxOf(group)).toEqual({ x: 80, y: 70, width: 800, height: 126 });
    expect(object(session, "title_01")?.parent).toBe("band_01");
  });

  it("rejects grouping a locked shape or a single shape", () => {
    const session = new Session(new SlidesAdapter());
    const locked = session.apply({ action: "group", ids: ["title_01", "logo_01"] });
    const single = session.apply({ action: "group", ids: ["title_01"] });

    expect(locked.issues?.some((issue) => issue.code === "locked")).toBe(true);
    expect(single.issues?.some((issue) => issue.code === "invalid_params")).toBe(true);
    expect(session.snapshot().revision).toBe(0);
  });

  it("rejects grouping shapes from different slides", () => {
    const session = new Session(new SlidesAdapter());
    const result = session.apply({ action: "group", ids: ["title_01", "body_02"] });
    expect(result.issues?.some((issue) => issue.message.includes("share one parent"))).toBe(true);
  });

  it("moves group members together", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "group", ids: ["title_01", "accent_01"], id: "band_01" });
    session.apply({ action: "move", target: "band_01", x: 100, y: 90 });

    expect(object(session, "title_01")?.properties.x).toBe(100);
    expect(object(session, "accent_01")?.properties.x).toBe(100);
    expect(object(session, "accent_01")?.properties.y).toBe(200);
  });

  it("keeps nested shapes in the relevant slice", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "group", ids: ["title_01", "accent_01"], id: "band_01" });
    const ids = session.relevant().objects.map((item) => item.id);

    expect(ids).toContain("slide_01");
    expect(ids).toContain("band_01");
    expect(ids).toContain("title_01");
    expect(ids).not.toContain("body_02");
  });

  it("refuses to delete a group that still has members, then ungroups", () => {
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "group", ids: ["title_01", "accent_01"], id: "band_01" });

    const blocked = session.apply({ action: "delete", target: "band_01" });
    expect(blocked.issues?.some((issue) => issue.code === "has_children")).toBe(true);

    const ungrouped = session.apply({ action: "ungroup", target: "band_01" });
    expect(ungrouped.status).toBe("accepted");
    expect(object(session, "band_01")).toBeUndefined();
    expect(object(session, "title_01")?.parent).toBe("slide_01");
  });
});
