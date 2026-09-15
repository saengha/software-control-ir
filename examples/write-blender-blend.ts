import { mkdirSync } from "node:fs";
import path from "node:path";
import { BlenderAdapter, defaultBlenderDocument } from "../src/index.js";

if (!BlenderAdapter.available()) {
  console.error("Blender is not installed.");
  process.exit(2);
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultBlenderDocument();
mkdirSync(path.dirname(target), { recursive: true });
const adapter = new BlenderAdapter({ seed: true });
try {
  adapter.save(target);
  console.log(`wrote ${target}`);
} finally {
  adapter.close();
}
