import "./load-env.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPARE_LIVE_MODEL,
  COMPARE_PROTOCOL,
  ImpressAdapter,
  copyImpressDocument,
  createLiveClient,
  defaultImpressContrastDocument,
  defaultImpressDocument,
  formatCompareTable,
  liveApiKey,
  parseCompareArgs,
  runCompareSuite,
  runCompareSuiteLive,
  runSlidesCompare,
  runSlidesCompareLive,
  type CompareRunLog,
} from "../src/index.js";

const args = parseCompareArgs(process.argv);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function suiteFilter() {
  return {
    ...(args.category ? { category: args.category } : {}),
    ...(args.tasks ? { tasks: args.tasks } : {}),
    repeats: args.repeats,
  };
}

function writeResults(title: string, logs: CompareRunLog[]) {
  const dir = path.join(root, "results");
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const model = args.driver === "live" ? COMPARE_LIVE_MODEL.replace(/[^\w.-]+/g, "_") : "scripted";
  const tasks = args.tasks?.join("+") ?? args.category ?? "all";
  const stem = `${day}-${title}-${model}-n${args.repeats}-${tasks}`;
  const table = formatCompareTable(logs, args.category ? { category: args.category } : undefined);
  const header = [
    `# Compare ${title}`,
    "",
    `- protocol: ${COMPARE_PROTOCOL.id} v${COMPARE_PROTOCOL.version}`,
    `- driver: ${args.driver}`,
    `- model: ${args.driver === "live" ? COMPARE_LIVE_MODEL : "scripted"}`,
    `- adapter: ${title}`,
    `- repeats: ${args.repeats}`,
    `- tasks: ${args.tasks?.join(", ") ?? args.category ?? "all"}`,
    `- when: ${new Date().toISOString()}`,
    "",
    "```",
    table,
    "```",
    "",
  ].join("\n");
  writeFileSync(path.join(dir, `${stem}.md`), header);
  writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(logs, null, 2));
  writeFileSync(path.join(dir, "latest.md"), header);
}

function print(title: string, logs: CompareRunLog[]) {
  const modelLine = args.driver === "live" ? `  model=${COMPARE_LIVE_MODEL}` : "  driver=scripted";
  const taskLine = args.tasks ? `  tasks=${args.tasks.join(",")}` : args.category ? `  category=${args.category}` : "";
  console.log(`=== ${title}  ${COMPARE_PROTOCOL.id} v${COMPARE_PROTOCOL.version}${modelLine} repeats=${args.repeats}${taskLine} ===`);
  console.log(formatCompareTable(logs, args.category ? { category: args.category } : undefined));
  console.log();
  writeResults(title, logs);
}

function impressBundle() {
  const board = copyImpressDocument();
  const contrastPath = defaultImpressContrastDocument();
  const contrast = existsSync(contrastPath) ? copyImpressDocument(contrastPath) : undefined;
  const adapter = new ImpressAdapter({ document: board });
  return {
    adapter,
    options: {
      ...suiteFilter(),
      prepare: (task: { fixture?: string }) => {
        if (task.fixture === "contrast") {
          if (!contrast) {
            throw new Error("fixtures/impress/contrast.odp is missing. Run npm run fixture:impress-contrast");
          }
          adapter.load(contrast);
          return;
        }
        adapter.load(board);
      },
      reset: () => adapter.reset(),
    },
  };
}

async function main() {
  if (args.driver === "live" && !liveApiKey()) {
    console.error("Live compare needs GEMINI_API_KEY (or ANTHROPIC_API_KEY).");
    console.error(`Both structured and vision use the same model: ${COMPARE_LIVE_MODEL}`);
    console.error("Copy .env.example to .env and fill the key, or pass --scripted.");
    process.exit(2);
  }

  if (args.dryRun) {
    console.log("dry-run: one repeat per task/policy\n");
  }

  if (args.adapter !== "impress") {
    if (args.driver === "live") {
      const client = createLiveClient(liveApiKey()!, COMPARE_LIVE_MODEL);
      print(
        "slides",
        await runSlidesCompareLive(client, suiteFilter()),
      );
    } else {
      print(
        "slides",
        runSlidesCompare(suiteFilter()),
      );
    }
  }

  if (args.adapter === "slides") return;

  if (!(ImpressAdapter.available() && existsSync(defaultImpressDocument()))) {
    console.log("=== impress skipped (LibreOffice or fixtures/impress/board.odp missing) ===\n");
    return;
  }

  const { adapter, options } = impressBundle();
  try {
    if (args.driver === "live") {
      const client = createLiveClient(liveApiKey()!, COMPARE_LIVE_MODEL);
      print("impress", await runCompareSuiteLive(adapter, client, options));
    } else {
      print("impress", runCompareSuite(adapter, options));
    }
  } finally {
    adapter.close();
  }
}

await main();
