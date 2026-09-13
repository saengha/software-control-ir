import { existsSync } from "node:fs";
import { copyImpressDocument, defaultImpressDocument, ImpressAdapter, LabAdapter, runConformance, SlidesAdapter } from "../src/index.js";

for (const adapter of [new SlidesAdapter(), new LabAdapter()]) {
  console.log(`=== ${adapter.id} ===`);
  for (const check of runConformance(adapter)) {
    console.log(`${check.ok ? "pass" : "FAIL"}  ${check.id.padEnd(34)} ${check.detail}`);
  }
  console.log();
}

if (ImpressAdapter.available() && existsSync(defaultImpressDocument())) {
  const adapter = new ImpressAdapter({ document: copyImpressDocument() });
  try {
    console.log(`=== ${adapter.id} ===`);
    for (const check of runConformance(adapter)) {
      console.log(`${check.ok ? "pass" : "FAIL"}  ${check.id.padEnd(34)} ${check.detail}`);
    }
    console.log();
  } finally {
    adapter.close();
  }
} else {
  console.log("=== impress === skipped (LibreOffice or fixtures/impress/board.odp missing)\n");
}
