import { SlidesAdapter } from "../adapters/slides.js";
import { compareStateSize } from "../ir/measure.js";
import { Session } from "../runtime/session.js";
import { runActions, summarize } from "./run.js";
import {
  boardTitleGoal,
  boardTitleNaive,
  boardTitleStructured,
  brandingBatch,
  recoveredTitleGoal,
  recoverTitleActions,
  untouchedTitleGoal,
} from "./tasks.js";

function atomicBatchRun() {
  const started = performance.now();
  const session = new Session(new SlidesAdapter());
  const transaction = session.transaction(brandingBatch);
  const checks = untouchedTitleGoal(session.snapshot());
  return {
    policy: "atomic-batch",
    status: transaction.status,
    rolledBack: transaction.rolledBack,
    metrics: summarize(session, started, checks),
    checks,
  };
}

function stateSizeRun() {
  const session = new Session(new SlidesAdapter({ preset: "deck" }));
  return compareStateSize(session.snapshot(), session.relevant());
}

export function runDefaultBench() {
  return {
    boardTitle: {
      structured: runActions(
        "structured",
        new SlidesAdapter({ preset: "blank" }),
        boardTitleStructured,
        boardTitleGoal,
      ),
      naive: runActions("naive", new SlidesAdapter({ preset: "blank" }), boardTitleNaive, boardTitleGoal),
    },
    recoverTitle: runActions("rollback", new SlidesAdapter(), recoverTitleActions, recoveredTitleGoal),
    atomicBatch: atomicBatchRun(),
    stateSize: stateSizeRun(),
  };
}
