# Compare tasks

Fixed goals for `scir-compare-v0` (prompt set v3, experiment log `schema/experiment.v2.json`). Both policies get the same `goalText`, the same step budget, and — when live — the **same model** (`SCIR_COMPARE_MODEL`, default in `.env` is `gemini-3.6-flash`). Frozen scripts remain available via `npm run compare:scripted`.

Live: `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`). Each tool call is one step. Default live model in `.env` is `gemini-3.6-flash`; structured and vision must share it. `gemini-2.5-flash` is closed to new keys.

A live model can finish `host_drift` in one `set_text` before `HOST_DRIFT_AFTER_STEPS`. The structured 5/5 in the 2026-09-13 pilot is not a drift-recovery result. See `results/`.

Recommended order before a full `9 × 2 × 5` run:

1. `npm run compare:scripted` — frozen scripts, no API.
2. `npm run compare:pilot` — live `contrast_check` + `host_drift`, N=5, slides only.
3. Full live: `npx tsx examples/compare.ts --repeats=5 --adapter=all`

`--task=` filters the suite (comma-separated ids). `--category=` filters by `execution` / `gated` / `vision-favorable`.

Vision tool results must not carry IR fields (`"locked": true`, object ids, `effects`, `issues`). Click still hit-tests internally; the model only sees the screenshot and visible chrome (`fill` / `text` panel, toasts).

## Categories

- **execution** — visible edits a screenshot agent can attempt: `rename_title`, `recolor_accent`, `add_callout`
- **gated** — lock, hidden slide, host drift, recovery, or all-or-nothing transaction: `recolor_locked_logo`, `edit_hidden_slide`, `host_drift`, `abort_rebrand`, `recover_title`
- **vision-favorable** — judged from a rendered image, not from IR success: `contrast_check`

`abort_rebrand` is gated: an all-or-nothing transaction is not something a UI-level vision agent can mimic.

## host_drift

`goalText` is only `Set the title to "Recovered".` The harness mutates the host after `HOST_DRIFT_AFTER_STEPS` (default 3) tool calls. That number is logged as `hostDriftAfterSteps`. Structured must `sync` after the divergence; vision has no `sync` tool.

## recover_title

Vision has no channel for “what was the previous value?” Structured recovery uses revision history (`undo`). Vision `FAILED` on this task is the structurally expected result. It is not evidence that the vision agent is incompetent; it shows the limit of the observation channel. The task is counted in the gated subtable, not in execution.

## recolor_locked_logo

Verdict follows `LOCKED_TARGET_POLICY` in `src/bench/compare/policy.ts`. Until a product decision lands, the default is `report_failed`: the agent must not unlock a locked target to apply the fill.

## contrast_check

White text on a light slide. The goal is to darken the background to blue. `set_fill` succeeding is not enough: the grader samples the final raster and fails the task when text-to-background contrast is below WCAG AA (4.5:1).
