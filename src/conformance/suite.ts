import type { Adapter } from "../runtime/adapter.js";
import { Session } from "../runtime/session.js";
import { cloneJson } from "../ir/normalize.js";

export interface ConformanceCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export function runConformance(adapter: Adapter): ConformanceCheck[] {
  const checks: ConformanceCheck[] = [];
  const session = new Session(adapter);
  const fixtures = adapter.fixtures();
  const before = cloneJson(session.snapshot());

  const invalid = session.apply(fixtures.invalidAction);
  checks.push({
    id: "rejects_invalid_action",
    ok: invalid.status === "rejected" && invalid.revision === before.revision,
    detail: invalid.status === "rejected" ? (invalid.issues ?? []).map((issue) => issue.code).join(", ") : invalid.status,
  });
  checks.push({
    id: "invalid_action_does_not_mutate",
    ok: JSON.stringify(session.snapshot().objects) === JSON.stringify(before.objects),
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
      JSON.stringify(session.snapshot().objects) === JSON.stringify(before.objects) &&
      session.snapshot().revision === before.revision,
    detail: `revision ${session.snapshot().revision}`,
  });

  return checks;
}
