import { describe, expect, it } from "vitest";
import { LabAdapter, runConformance } from "../src/index.js";

describe("adapter conformance", () => {
  it("passes the v0 checks for the lab adapter", () => {
    const checks = runConformance(new LabAdapter());
    const failed = checks.filter((check) => !check.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });
});
