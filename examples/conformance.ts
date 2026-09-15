import { existsSync } from "node:fs";
import {
  BlenderAdapter,
  copyImpressDocument,
  defaultImpressDocument,
  ImpressAdapter,
  KritaAdapter,
  LabAdapter,
  runConformance,
  SlidesAdapter,
} from "../src/index.js";

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

if (BlenderAdapter.available()) {
  const adapter = new BlenderAdapter({ seed: true });
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
  console.log("=== blender === skipped (Blender missing; set SCIR_BLENDER)\n");
}

if (KritaAdapter.available()) {
  const adapter = new KritaAdapter({ seed: true });
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
  console.log("=== krita === skipped (Krita missing; set SCIR_KRITA)\n");
}
