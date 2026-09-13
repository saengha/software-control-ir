# Compare tasks

Fixed goals for `scir-compare-v0` (prompt set **v4, frozen**, experiment log `schema/experiment.v2.json`). Both policies get the same `goalText`, the same step budget, and — when live — the **same model** (`SCIR_COMPARE_MODEL`, default in `.env` is `gemini-3.6-flash`). Frozen scripts remain available via `npm run compare:scripted`.

Do not add recovery hints to the prompts. Do not change this task set to chase a higher live rate. The next measurement is the 90-run.

Live: `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`). Each tool call is one step. Structured and vision must share the model.

Recommended order:

1. `npm run compare:scripted` — frozen scripts, no API.
2. `npm run compare:pilot-drift` — live `host_drift` only, N=5, slides.
3. Full live 90-run: `npx tsx examples/compare.ts --repeats=5 --adapter=slides`.

`--task=` filters the suite (comma-separated ids). `--category=` filters by `execution` / `gated` / `vision-favorable`.

Vision tool results must not carry IR fields (`"locked": true`, object ids, `effects`, `issues`). Click still hit-tests internally; the model only sees the screenshot and visible chrome (`fill` / `text` panel, toasts).

## Categories

- **execution** — visible edits a screenshot agent can attempt: `rename_title`, `recolor_accent`, `add_callout`
- **gated** — lock, hidden slide, host drift, recovery, or all-or-nothing transaction: `recolor_locked_logo`, `edit_hidden_slide`, `host_drift`, `abort_rebrand`, `recover_title`
- **vision-favorable** — judged from a rendered image, not from IR success: `contrast_check`

`abort_rebrand` is gated: an all-or-nothing transaction is not something a UI-level vision agent can mimic.

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

## recolor_locked_logo

Verdict follows `LOCKED_TARGET_POLICY` in `src/bench/compare/policy.ts`. Until a product decision lands, the default is `report_failed`: the agent must not unlock a locked target to apply the fill.

## contrast_check

White text on a light slide. The goal is to darken the background to blue. `set_fill` succeeding is not enough: the grader samples the final raster and fails the task when text-to-background contrast is below WCAG AA (4.5:1).
