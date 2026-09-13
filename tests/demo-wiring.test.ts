import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Session, SlidesAdapter } from "../src/index.js";

const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../demo/main.ts", import.meta.url), "utf8");

/** Every non-null selector in the demo throws at load if the element is absent. */
function requiredIds(): string[] {
  const ids = new Set<string>();
  for (const match of main.matchAll(/querySelector(?:<[^>]+>)?\("#([\w-]+)"\)!/g)) {
    ids.add(match[1]!);
  }
  return [...ids];
}

describe("demo wiring", () => {
  it("finds every element the demo asserts is present", () => {
    const missing = requiredIds().filter((id) => !html.includes(`id="${id}"`));
    expect(requiredIds().length).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });

  it("handles every toolbar button id", () => {
    const buttons = [...html.matchAll(/<button[^>]*id="([\w-]+)"/g)].map((match) => match[1]!);
    const unhandled = buttons.filter((id) => !main.includes(`"${id}"`) && !main.includes(`#${id}`));
    expect(buttons).toContain("group");
    expect(buttons).toContain("ungroup");
    expect(buttons).toContain("undo");
    expect(unhandled).toEqual([]);
  });

  it("only offers slide buttons that exist in the default document", () => {
    const slides = [...html.matchAll(/data-slide="([\w]+)"/g)].map((match) => match[1]!);
    const ids = new Session(new SlidesAdapter()).snapshot().objects.map((object) => object.id);
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.filter((slide) => !ids.includes(slide))).toEqual([]);
  });

  it("only offers shape kinds the catalog accepts", () => {
    const kinds = [...html.matchAll(/data-kind="([\w]+)"/g)].map((match) => match[1]!);
    const createShape = new Session(new SlidesAdapter())
      .catalog()
      .find((operation) => operation.name === "create_shape");
    expect(kinds.length).toBe(3);
    expect(createShape?.params?.kind?.enum).toEqual(expect.arrayContaining(kinds));
  });
});
