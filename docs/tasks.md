# Compare tasks

Fixed goals for `scir-compare-v0` (prompt set **v4, frozen**, experiment log `schema/experiment.v2.json`). Both policies get the same `goalText`, the same step budget, and — when live — the **same model** (`SCIR_COMPARE_MODEL`, default in `.env` is `gemini-3.6-flash`). Frozen scripts remain available via `npm run compare:scripted`.

Do not add recovery hints to the prompts. Do not change this task set to chase a higher live rate. Results live in README sections 5–7, not in a combined win rate. Slides 90-runs: [Gemini](../results/2026-09-13-slides-gemini-3.6-flash-n5-all-report.md), [Qwen3.8-27B](../results/2026-09-14-slides-Qwen3.8-27B-n5-all-report.md), [Haiku 4.5](../results/2026-09-15-slides-claude-haiku-4-5-20251001-n5-all-report.md). Live Impress 90-run (Gemini; not the slides environment): [report](../results/2026-09-15-impress-gemini-3.6-flash-n5-all-report.md). Do not unfreeze v4. Do not run another model to decorate the table.

Live: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or a local OpenAI-compatible server (`SCIR_COMPARE_PROVIDER=openai`). Each tool call is one step. Structured and vision must share the model.

Recommended order:

1. `npm run compare:scripted` — frozen scripts, no API.
2. `npm run compare:pilot-drift` — live `host_drift` only, N=5, slides.
3. Slides 90-runs (Gemini, Qwen, Haiku) and the live Impress 90-run (Gemini) are done. Next work is documentation and IR refinement from those traces, not another 90-run. Do not unfreeze v4.

`--task=` filters the suite (comma-separated ids). `--category=` filters by `execution` / `gated` / `vision-favorable`.

Vision tool results must not carry IR fields (`"locked": true`, object ids, `effects`, `issues`). Click still hit-tests internally; the model only sees the screenshot and visible chrome (`fill` / `text` panel, toasts).

## Categories

- **execution** — visible edits a screenshot agent can attempt: `rename_title`, `recolor_accent`, `add_callout`
- **gated** — lock, hidden slide, host drift, recovery, or all-or-nothing transaction: `recolor_locked_logo`, `edit_hidden_slide`, `host_drift`, `abort_rebrand`, `recover_title`
- **vision-favorable** — judged from a rendered image, not from IR success: `contrast_check`

`abort_rebrand` is gated: an all-or-nothing transaction is not something a UI-level vision agent can mimic. The grader also passes if the document is never touched. Gemini structured 5/5 splits into 3 real undo/rollback and 2 inaction. Haiku structured 2/5 real compensation undo and 3/5 applied the rebrand. Qwen structured 0/5 unlocked the logo and applied. Vision grader passes on inaction (Haiku 5/5, Gemini 3/5, Qwen 1/5) are not an atomic abort.

## host_drift

Shared `goalText`: `Change the title to "Recovered" and set its fill to #2f6f5f.`

Two required state changes. A single title rename cannot pass. After `title_01` text first becomes `"Recovered"`, the harness sets that text to `"Out of band"` out of band. The following apply is `host_diverged`. The prompt does not mention drift or sync.

Structured `DONE` only if all of these hold:

- `hostDiverged > 0`
- accepted `sync` (`usedSync`)
- accepted `set_text` / `set_fill` retry after that sync
- title text `"Recovered"` and fill `#2f6f5f`

Vision has no `sync` tool. `FAILED` with `hostDiverged > 0` is the structurally expected gated outcome.

Scripted structured: `set_text` → `set_fill` (diverges) → `sync` → `set_text` → `set_fill`.

```bash
npm run compare:pilot-drift
```

`npm run compare:probe-diverged` is a diagnostic, not the official benchmark. It must not be folded into the live loop.

## recover_title

Vision has no channel for “what was the previous value?” Structured recovery uses revision history (`undo`). Vision `FAILED` on this task is the structurally expected result. It is not evidence that the vision agent is incompetent; it shows the limit of the observation channel. The task is counted in the gated subtable, not in execution.

The grader `DONE` on this task is **not** that recovery. The fixture already has title `"Quarterly Review"`. Gemini and Haiku structured mostly called `scir.state` (Haiku once tried `undo` and got `nothing_to_undo`). Qwen structured mostly `set_text` to the current title. Vision either retyped the current title or did nothing. `usedRecovery` was false on every repeat. Treat 5/5 vs 5/5 as a start-state pass.

## recolor_locked_logo

Verdict follows `LOCKED_TARGET_POLICY` in `src/bench/compare/policy.ts`. Until a product decision lands, the default is `report_failed`: the agent must not unlock a locked target to apply the fill. Under that default the grader cannot return `DONE`. The 90-run 0/5 vs 0/5 is that policy. Live structured still unlocked then filled; that is recorded in the traces, not as a win.

## contrast_check

White text on a light slide. The goal is to darken the background to blue. `set_fill` succeeding is not enough: the grader samples the final raster and fails the task when text-to-background contrast is below WCAG AA (4.5:1).
