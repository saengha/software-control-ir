import type { Adapter } from "../runtime/adapter.js";
import { Session } from "../runtime/session.js";
import { cloneJson } from "../ir/normalize.js";

export interface ConformanceCheck {
  id: string;
  ok: boolean;
  detail: string;
}

function sameObjects(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function runConformance(adapter: Adapter): ConformanceCheck[] {
  const checks: ConformanceCheck[] = [];
  // Fixtures are not required to be idempotent, so every section starts here.
  const initial = cloneJson(adapter.snapshot());
  const session = new Session(adapter);
  const fixtures = adapter.fixtures();
  const before = cloneJson(session.snapshot());

  const invalid = session.apply(fixtures.invalidAction);
  checks.push({
    id: "rejects_invalid_action",
    ok: invalid.status === "rejected" && invalid.revision === before.revision,
    detail:
      invalid.status === "rejected" ? (invalid.issues ?? []).map((issue) => issue.code).join(", ") : invalid.status,
  });
  checks.push({
    id: "invalid_action_does_not_mutate",
    ok: sameObjects(session.snapshot().objects, before.objects),
    detail: "state after rejected action",
  });

  const valid = session.apply(fixtures.validAction);
  checks.push({
    id: "resolves_target",
    ok: valid.status === "accepted" && Boolean(valid.focus?.before || valid.focus?.after),
    detail: valid.focus?.before?.id ?? valid.focus?.after?.id ?? "no focus",
  });
  checks.push({
    id: "performs_operation",
    ok: valid.status === "accepted",
    detail: valid.status,
  });
  checks.push({
    id: "reports_resulting_state",
    ok: valid.status === "accepted" && valid.after.revision === before.revision + 1,
    detail: `revision ${valid.after.revision}`,
  });
  checks.push({
    id: "reports_effects",
    ok: valid.status === "accepted" && valid.effects.length > 0,
    detail: `${valid.effects.length} effects`,
  });
  checks.push({
    id: "creates_revision",
    ok: valid.status === "accepted" && session.history().length === 1 && session.snapshot().revision === 1,
    detail: `history ${session.history().length}`,
  });

  const rolled = session.rollback(before.revision);
  checks.push({
    id: "restores_previous_state",
    ok:
      rolled.status === "accepted" &&
      sameObjects(session.snapshot().objects, before.objects) &&
      session.snapshot().revision === before.revision,
    detail: `revision ${session.snapshot().revision}`,
  });

  adapter.restore(cloneJson(initial));
  checks.push(...describeChecks(adapter));

  adapter.restore(cloneJson(initial));
  checks.push(...batchChecks(adapter));

  adapter.restore(cloneJson(initial));
  checks.push(...undoChecks(adapter));

  return checks;
}

function describeChecks(adapter: Adapter): ConformanceCheck[] {
  const session = new Session(adapter);
  const description = session.describe();
  return [
    {
      id: "describes_itself",
      ok:
        description.adapter.length > 0 &&
        description.objectTypes.length > 0 &&
        description.operations.core.length > 0,
      detail: `${description.objectTypes.length} types, ${description.operations.domain.length} domain ops`,
    },
  ];
}

function batchChecks(adapter: Adapter): ConformanceCheck[] {
  const session = new Session(adapter);
  const fixtures = adapter.fixtures();
  const before = cloneJson(session.snapshot());

  const aborted = session.transaction([fixtures.validAction, fixtures.invalidAction]);
  const checks: ConformanceCheck[] = [
    {
      id: "aborted_batch_leaves_no_changes",
      ok:
        aborted.status !== "accepted" &&
        sameObjects(session.snapshot().objects, before.objects) &&
        session.snapshot().revision === before.revision,
      detail: `${aborted.status}, rolledBack=${aborted.rolledBack}`,
    },
  ];

  const committed = session.transaction([fixtures.validAction]);
  checks.push({
    id: "committed_batch_reports_effects",
    ok: committed.status === "accepted" && committed.effects.length > 0,
    detail: `${committed.effects.length} effects`,
  });

  return checks;
}

function undoChecks(adapter: Adapter): ConformanceCheck[] {
  const session = new Session(adapter);
  const fixtures = adapter.fixtures();
  const before = cloneJson(session.snapshot());

  session.apply(fixtures.validAction);
  const undone = session.undo();

  return [
    {
      id: "undo_restores_previous_state",
      ok: undone.status === "accepted" && sameObjects(session.snapshot().objects, before.objects),
      detail: `${undone.status} via ${undone.recovery ?? "none"}`,
    },
    {
      id: "undo_reports_mechanism",
      ok: undone.recovery === "compensation" || undone.recovery === "snapshot",
      detail: undone.recovery ?? "none",
    },
  ];
}
