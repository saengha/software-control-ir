import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultKritaDocument, KritaAdapter } from "../src/index.js";

if (!KritaAdapter.available()) {
  console.error("Krita is not installed.");
  process.exit(2);
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultKritaDocument();
mkdirSync(path.dirname(target), { recursive: true });
const adapter = new KritaAdapter({ seed: true });
try {
  adapter.save(target);
  console.log(`wrote ${target}`);
} finally {
  adapter.close();
}
