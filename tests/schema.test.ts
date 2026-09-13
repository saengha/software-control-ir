import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import { LabAdapter, Session, SlidesAdapter } from "../src/index.js";

const schema = JSON.parse(readFileSync(new URL("../schema/scir.v0.json", import.meta.url), "utf8"));

let ajv: Ajv;

function validator(name: string) {
  return ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
}

function explain(validate: ReturnType<Ajv["compile"]>): string {
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`).join("; ");
}

beforeAll(() => {
  ajv = new Ajv({ strict: false });
  ajv.addSchema(schema);
});

describe("scir.v0 schema", () => {
  it("accepts state from both adapters", () => {
    const validate = validator("state");
    for (const adapter of [new SlidesAdapter(), new LabAdapter()]) {
      const state = new Session(adapter).snapshot();
      expect(validate(state), `${adapter.id}: ${explain(validate)}`).toBe(true);
    }
  });

  it("accepts an accepted result and a rejected result", () => {
    const validate = validator("result");
    const session = new Session(new SlidesAdapter());

    const accepted = session.apply({ action: "set_text", target: "title_01", value: "Schema" });
    expect(validate(accepted), explain(validate)).toBe(true);

    const rejected = session.apply({ action: "set_fill", target: "logo_01", value: "#ff0000" });
    expect(validate(rejected), explain(validate)).toBe(true);
  });

  it("accepts a result that reports its recovery mechanism", () => {
    const validate = validator("result");
    const session = new Session(new SlidesAdapter());
    session.apply({ action: "set_text", target: "title_01", value: "Schema" });
    const undone = session.undo();

    expect(undone.recovery).toBe("compensation");
    expect(validate(undone), explain(validate)).toBe(true);
  });

  it("accepts a transaction that aborted", () => {
    const validate = validator("transaction");
    const session = new Session(new SlidesAdapter());
    const outcome = session.transaction([
      { action: "set_text", target: "title_01", value: "Schema" },
      { action: "set_fill", target: "logo_01", value: "#ff0000" },
    ]);

    expect(outcome.rolledBack).toBe(true);
    expect(validate(outcome), explain(validate)).toBe(true);
  });

  it("accepts declared capabilities", () => {
    const validate = validator("capabilities");
    const description = new Session(new SlidesAdapter()).describe();
    expect(validate(description.capabilities), explain(validate)).toBe(true);
  });

  it("rejects an object that is missing its type", () => {
    const validate = validator("object");
    expect(validate({ id: "x", properties: {} })).toBe(false);
    expect(validate({ id: "x", type: "rectangle", properties: {} })).toBe(true);
  });

  it("accepts an action that names the revision it was planned against", () => {
    const validate = validator("action");
    expect(validate({ action: "set_text", target: "title_01", params: { value: "Hi" }, expectedRevision: 3 })).toBe(
      true,
    );
    expect(validate({ action: "set_text", expectedRevision: 1.5 })).toBe(false);
  });

  it("rejects an unknown effect kind", () => {
    const validate = validator("effect");
    expect(validate({ kind: "mutate", target: "x" })).toBe(false);
    expect(validate({ kind: "update", target: "x", path: "properties.x", from: 1, to: 2 })).toBe(true);
  });
});
