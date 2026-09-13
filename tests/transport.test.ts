import { describe, expect, it } from "vitest";
import { createDispatcher, Session, SlidesAdapter, toolDescriptors } from "../src/index.js";

describe("catalog projected as tools", () => {
  it("describes every operation with a typed input schema", () => {
    const session = new Session(new SlidesAdapter());
    const tools = toolDescriptors(session);
    const createShape = tools.find((tool) => tool.name === "slides.create_shape")!;

    expect(tools.some((tool) => tool.name === "scir.describe")).toBe(true);
    expect(createShape.inputSchema.required).toEqual(
      expect.arrayContaining(["kind", "x", "y", "width", "height"]),
    );
    expect(createShape.inputSchema.properties.kind).toMatchObject({
      type: "string",
      enum: ["rectangle", "ellipse", "textbox"],
    });
  });

  it("marks a required target and its accepted types", () => {
    const session = new Session(new SlidesAdapter());
    const setFill = toolDescriptors(session).find((tool) => tool.name === "slides.set_fill")!;
    expect(setFill.inputSchema.required).toContain("target");
    expect(setFill.inputSchema.properties.target?.description).toContain("rectangle");
  });

  it("applies an operation call and returns a compact result", () => {
    const session = new Session(new SlidesAdapter());
    const call = createDispatcher(session);
    const result = call("slides.set_text", { target: "title_01", value: "Via transport" }) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({ status: "accepted", revision: 1 });
    expect(result.before).toBeUndefined();
    expect(result.after).toBeUndefined();
    expect(session.snapshot().objects.find((item) => item.id === "title_01")?.properties.text).toBe(
      "Via transport",
    );
  });

  it("returns relevant state by default and full state on request", () => {
    const session = new Session(new SlidesAdapter({ preset: "deck" }));
    const call = createDispatcher(session);
    const relevant = call("scir.state") as { objects: unknown[] };
    const full = call("scir.state", { scope: "full" }) as { objects: unknown[] };

    expect(relevant.objects.length).toBeLessThan(full.objects.length);
  });

  it("runs a batch and an undo through the transport", () => {
    const session = new Session(new SlidesAdapter());
    const call = createDispatcher(session);

    const batch = call("scir.transaction", {
      actions: [
        { action: "set_text", target: "title_01", value: "Batched" },
        { action: "set_fill", target: "logo_01", value: "#000000" },
      ],
    }) as Record<string, unknown>;
    expect(batch).toMatchObject({ status: "rejected", rolledBack: true });

    call("slides.set_text", { target: "title_01", value: "Kept" });
    const undone = call("scir.undo") as Record<string, unknown>;
    expect(undone).toMatchObject({ status: "accepted", recovery: "compensation" });
  });

  it("reports unknown tools instead of guessing", () => {
    const session = new Session(new SlidesAdapter());
    const call = createDispatcher(session);
    expect(call("slides.render_pdf")).toMatchObject({ status: "rejected" });
    expect(call("other.set_text")).toMatchObject({ error: { code: "unknown_tool" } });
  });

  it("exposes capabilities through describe", () => {
    const session = new Session(new SlidesAdapter());
    const description = createDispatcher(session)("scir.describe") as Record<string, unknown>;
    expect(description).toMatchObject({
      adapter: "slides",
      capabilities: { transactions: true, compensation: true, relevantState: true, hierarchy: true },
    });
  });
});
