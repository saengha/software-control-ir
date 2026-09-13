import { existsSync } from "node:fs";
import {
  COMPARE_LIVE_MODEL,
  COMPARE_PROTOCOL,
  ImpressAdapter,
  copyImpressDocument,
  createAnthropicClient,
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

function suiteFilter() {
  return {
    ...(args.category ? { category: args.category } : {}),
    ...(args.tasks ? { tasks: args.tasks } : {}),
    repeats: args.repeats,
  };
}

function print(title: string, logs: CompareRunLog[]) {
  const modelLine = args.driver === "live" ? `  model=${COMPARE_LIVE_MODEL}` : "  driver=scripted";
  const taskLine = args.tasks ? `  tasks=${args.tasks.join(",")}` : args.category ? `  category=${args.category}` : "";
  console.log(`=== ${title}  ${COMPARE_PROTOCOL.id} v${COMPARE_PROTOCOL.version}${modelLine} repeats=${args.repeats}${taskLine} ===`);
  console.log(formatCompareTable(logs, args.category ? { category: args.category } : undefined));
  console.log();
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
    console.error("Live compare needs ANTHROPIC_API_KEY (or SCIR_ANTHROPIC_API_KEY).");
    console.error(`Both structured and vision use the same model: ${COMPARE_LIVE_MODEL}`);
    console.error("Pass --scripted for the frozen-script baseline, or set a key and use --dry-run first.");
    process.exit(2);
  }

  if (args.dryRun) {
    console.log("dry-run: one repeat per task/policy\n");
  }

  if (args.adapter !== "impress") {
    if (args.driver === "live") {
      const client = createAnthropicClient(liveApiKey()!, COMPARE_LIVE_MODEL);
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
      const client = createAnthropicClient(liveApiKey()!, COMPARE_LIVE_MODEL);
      print("impress", await runCompareSuiteLive(adapter, client, options));
    } else {
      print("impress", runCompareSuite(adapter, options));
    }
  } finally {
    adapter.close();
  }
}

await main();
