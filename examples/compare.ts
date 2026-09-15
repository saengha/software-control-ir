import "./load-env.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import os from "node:os";
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
  libreOfficeProgram,
  parseCompareArgs,
  runCompareSuite,
  runCompareSuiteLive,
  runSlidesCompare,
  runSlidesCompareLive,
  type CompareRunLog,
} from "../src/index.js";

const args = parseCompareArgs(process.argv);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitHead(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root, windowsHide: true }).trim();
  } catch {
    return undefined;
  }
}

function libreOfficeVersion(): string | undefined {
  const program = libreOfficeProgram();
  if (!program) return undefined;
  try {
    return execFileSync(path.join(program, "soffice.com"), ["--version"], {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
}

function impressReady(): boolean {
  return ImpressAdapter.available() && existsSync(defaultImpressDocument());
}

function environmentLines(title: string): string[] {
  const host =
    title === "impress"
      ? "real LibreOffice Impress process (UNO)"
      : "in-memory slides adapter (not LibreOffice)";
  const lines = [
    `- host: ${host}`,
    `- os: ${os.platform()} ${os.release()}`,
  ];
  const commit = gitHead();
  if (commit) lines.push(`- git: ${commit}`);
  if (title === "impress") {
    const version = libreOfficeVersion();
    if (version) lines.push(`- libreoffice: ${version}`);
    lines.push(`- fixture: ${defaultImpressDocument()}`);
    lines.push(`- contrastFixture: ${defaultImpressContrastDocument()}`);
    lines.push("- documentState: UNO snapshot of the live .odp");
    lines.push("- visionChrome: synthetic toolbar overlay (not the Impress UI)");
    lines.push("- contrastGrader: frozen v4 IR canvas raster (host PNG is not the verdict)");
  }
  return lines;
}

function resultStem(title: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const model = args.driver === "live" ? COMPARE_LIVE_MODEL.replace(/[^\w.-]+/g, "_") : "scripted";
  const tasks = args.tasks?.join("+") ?? args.category ?? "all";
  return `${day}-${title}-${model}-n${args.repeats}-${tasks}`;
}

function jsonlPath(title: string): string {
  const override = process.env.SCIR_COMPARE_JSONL;
  if (override) {
    const resolved = path.isAbsolute(override) ? override : path.join(root, override);
    mkdirSync(path.dirname(resolved), { recursive: true });
    return resolved;
  }
  const dir = path.join(root, "results");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${resultStem(title)}.jsonl`);
}

function suiteFilter(title?: string) {
  const onLog =
    args.driver === "live" && title
      ? (log: CompareRunLog) => {
          appendFileSync(jsonlPath(title), `${JSON.stringify(log)}\n`);
        }
      : undefined;
  return {
    ...(args.category ? { category: args.category } : {}),
    ...(args.tasks ? { tasks: args.tasks } : {}),
    repeats: args.repeats,
    ...(onLog ? { onLog } : {}),
  };
}

function writeResults(title: string, logs: CompareRunLog[]) {
  const dir = path.join(root, "results");
  mkdirSync(dir, { recursive: true });
  const stem = resultStem(title);
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
    ...environmentLines(title),
    "",
    "```",
    table,
    "```",
    "",
  ].join("\n");
  writeFileSync(path.join(dir, `${stem}.md`), header);
  writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(logs, null, 2));
  writeFileSync(path.join(dir, "latest.md"), header);
  if (title === "impress") {
    writeFileSync(
      path.join(dir, `${stem}-env.json`),
      JSON.stringify(
        {
          protocol: COMPARE_PROTOCOL.id,
          protocolVersion: COMPARE_PROTOCOL.version,
          driver: args.driver,
          adapter: "impress",
          host: "libreoffice-impress",
          synthetic: false,
          visionChrome: "synthetic",
          contrastGrader: "ir-canvas-raster",
          documentState: "uno-snapshot",
          os: `${os.platform()} ${os.release()}`,
          libreoffice: libreOfficeVersion() ?? null,
          fixture: defaultImpressDocument(),
          contrastFixture: defaultImpressContrastDocument(),
          git: gitHead() ?? null,
          model: args.driver === "live" ? COMPARE_LIVE_MODEL : "scripted",
          repeats: args.repeats,
          tasks: args.tasks ?? args.category ?? "all",
          when: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
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
      ...suiteFilter("impress"),
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
    console.error("Live compare needs GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or a local SCIR_COMPARE_BASE_URL.");
    console.error(`Both structured and vision use the same model: ${COMPARE_LIVE_MODEL}`);
    console.error("Copy .env.example to .env, or point SCIR_COMPARE_PROVIDER=openai at a vLLM / OpenAI-compatible server.");
    process.exit(2);
  }

  if (args.dryRun) {
    console.log("dry-run: one repeat per task/policy\n");
  }

  if (args.adapter === "impress") {
    if (!impressReady()) {
      console.error("=== impress unavailable (LibreOffice or fixtures/impress/board.odp missing) ===");
      console.error("Not falling back to slides. This is not a live-app run.");
      process.exit(2);
    }
  } else {
    if (args.driver === "live") {
      const client = createLiveClient(liveApiKey()!, COMPARE_LIVE_MODEL);
      print(
        "slides",
        await runSlidesCompareLive(client, suiteFilter("slides")),
      );
    } else {
      print(
        "slides",
        runSlidesCompare(suiteFilter()),
      );
    }
  }

  if (args.adapter === "slides") return;

  if (!impressReady()) {
    console.log("=== impress skipped (LibreOffice or fixtures/impress/board.odp missing) ===\n");
    return;
  }

  console.log(
    `=== impress host=real LibreOffice  driver=${args.driver}  visionChrome=synthetic ===`,
  );

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
