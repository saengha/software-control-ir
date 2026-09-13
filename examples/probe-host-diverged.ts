import "./load-env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPARE_LIVE_MODEL,
  createLiveClient,
  formatHostDivergedProbe,
  liveApiKey,
  runHostDivergedProbe,
  type HostDivergedProbeLog,
} from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repeats = Math.max(1, Number(process.env.SCIR_PROBE_REPEATS ?? process.argv.find((arg) => arg.startsWith("--repeats="))?.slice(10) ?? 3));

function write(logs: HostDivergedProbeLog[]) {
  const dir = path.join(root, "results");
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const model = COMPARE_LIVE_MODEL.replace(/[^\w.-]+/g, "_");
  const stem = `${day}-probe-host-diverged-${model}-n${repeats}`;
  const body = [
    "# host_diverged structured probe",
    "",
    "Not a win-rate run. Same host_drift prompt, tools, fixture, and model.",
    "After the usual inject/Continue path, one function-call-required turn is used",
    "only if the model never applied after inject, so a real host_diverged tool_result",
    "can sit in Gemini context. No recovery instruction is added to the prompt.",
    "",
    `- model: ${COMPARE_LIVE_MODEL}`,
    `- repeats: ${repeats}`,
    `- when: ${new Date().toISOString()}`,
    "",
    "```",
    formatHostDivergedProbe(logs),
    "```",
    "",
  ].join("\n");
  writeFileSync(path.join(dir, `${stem}.md`), body);
  writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(logs, null, 2));
  console.log(`wrote results/${stem}.md`);
}

async function main() {
  const key = liveApiKey();
  if (!key) {
    console.error("Needs GEMINI_API_KEY (or ANTHROPIC_API_KEY). Copy .env.example to .env.");
    process.exit(2);
  }
  const client = createLiveClient(key, COMPARE_LIVE_MODEL);
  const logs: HostDivergedProbeLog[] = [];
  for (let runIndex = 0; runIndex < repeats; runIndex += 1) {
    console.log(`--- probe run ${runIndex + 1}/${repeats} ---`);
    const log = await runHostDivergedProbe(client, { runIndex });
    logs.push(log);
    console.log(formatHostDivergedProbe([log]));
  }
  write(logs);
}

await main();
