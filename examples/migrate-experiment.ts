import { readFileSync, writeFileSync } from "node:fs";
import { migrateExperimentLogs } from "../src/index.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: tsx examples/migrate-experiment.ts <v0.json> [v1.json]");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(input, "utf8")) as unknown;
const migrated = migrateExperimentLogs(raw);
const out = Array.isArray(raw) ? migrated : migrated[0];
const dest = process.argv[3];
const text = `${JSON.stringify(out, null, 2)}\n`;
if (dest) {
  writeFileSync(dest, text);
} else {
  process.stdout.write(text);
}
