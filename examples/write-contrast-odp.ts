import { mkdirSync } from "node:fs";
import path from "node:path";
import { defaultImpressContrastDocument, ImpressAdapter } from "../src/index.js";

if (!ImpressAdapter.available()) {
  console.error("LibreOffice is not installed.");
  process.exit(2);
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultImpressContrastDocument();
mkdirSync(path.dirname(target), { recursive: true });
const adapter = new ImpressAdapter({ seed: "contrast" });
try {
  adapter.save(target);
  console.log(`wrote ${target}`);
} finally {
  adapter.close();
}
