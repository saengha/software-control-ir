import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultImpressDocument, ImpressAdapter } from "../src/index.js";

if (!ImpressAdapter.available()) {
  console.error("LibreOffice is not installed.");
  process.exit(2);
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultImpressDocument();
mkdirSync(path.dirname(target), { recursive: true });
const adapter = new ImpressAdapter({ seed: true });
try {
  adapter.save(target);
  console.log(`wrote ${target}`);
} finally {
  adapter.close();
}
