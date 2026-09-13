import { LabAdapter, runConformance, SlidesAdapter } from "../src/index.js";

for (const adapter of [new SlidesAdapter(), new LabAdapter()]) {
  console.log(`=== ${adapter.id} ===`);
  for (const check of runConformance(adapter)) {
    console.log(`${check.ok ? "pass" : "FAIL"}  ${check.id.padEnd(34)} ${check.detail}`);
  }
  console.log();
}
