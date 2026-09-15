# Live 90-run (v4, frozen) — LibreOffice Impress

- protocol: `scir-compare-v0` **v4** (unchanged)
- driver: **live** (not scripted)
- model: `gemini-3.6-flash` (same model for both policies)
- adapter: **impress** (real headless LibreOffice, private `UserInstallation`)
- host: LibreOffice 26.8.0.3 on Windows 10.0.26100
- fixtures: `fixtures/impress/board.odp`, `fixtures/impress/contrast.odp` (copied to temp; repository files not written)
- document state: UNO snapshot of the live `.odp` (`adapter.snapshot()`), not `ActionResult.effects`
- vision chrome: **synthetic toolbar overlay**, not the Impress UI
- contrast grader: frozen v4 **IR canvas raster** (host PNG is exported for vision screenshots, not for the verdict)
- repeats: N=5
- size: 9 tasks × 2 policies × 5 = **90** (none skipped)
- elapsed: ~27.0 min (`2026-09-15T11:15:02Z` → `2026-09-15T11:42:03Z`)
- command: `npx tsx examples/compare.ts --repeats=5 --adapter=impress` with `SCIR_COMPARE_PROVIDER=gemini` `SCIR_COMPARE_MODEL=gemini-3.6-flash`
- env: [2026-09-15-impress-gemini-3.6-flash-n5-all-env.json](2026-09-15-impress-gemini-3.6-flash-n5-all-env.json)
- logs: [2026-09-15-impress-gemini-3.6-flash-n5-all.md](2026-09-15-impress-gemini-3.6-flash-n5-all.md), [2026-09-15-impress-gemini-3.6-flash-n5-all.json](2026-09-15-impress-gemini-3.6-flash-n5-all.json), [2026-09-15-impress-gemini-3.6-flash-n5-all.jsonl](2026-09-15-impress-gemini-3.6-flash-n5-all.jsonl) (jsonl written from the completed json after the process exited)
- paired slides run (same model, in-memory adapter): [2026-09-13-slides-gemini-3.6-flash-n5-all-report.md](2026-09-13-slides-gemini-3.6-flash-n5-all-report.md)

This is **not** equivalent to the slides 90-runs. Those used an in-memory deck. This used a live Impress process. Vision still does not see Impress chrome.

Do not lead with the combined rate. Gated tasks are structurally easier for structured. Several grader `DONE`s are “left the start state alone,” not recovery.

Machine table (grader): structured **36/45**, vision **16/45**. That number is not the finding. Same model on slides was 40/45 vs 19/45.

## Preconditions (not the 90-run)

1. `npx vitest run tests/impress.test.ts` — 14/14, including a smoke that checks `set_text` on a fresh UNO snapshot, not `ActionResult.effects`. Save/reopen round-trip also passed.
2. `npx tsx examples/compare.ts --scripted --adapter=impress` — frozen scripts on live Impress, ~7.4 min. Grader matches the known scripted split (`recover_title` vision 0/5 because the script types `"Oops"`; live `contrast_check` structured 0/5 WCAG miss). Driver=`scripted`, host=real LibreOffice.
3. Live one-task smoke: `--task=rename_title --repeats=1 --adapter=impress` — structured `DONE` (`title_text=Board Update` from UNO), vision `FAILED` (title stayed `"Quarterly Review"`).

## Category tables (grader)

### Execution — structured 15/15, vision 2/15

Slides Gemini on the same tasks: 15/15 vs 6/15. Live Impress vision is worse on title text.

| Task | structured | vision | What the traces show |
| --- | --- | --- | --- |
| `rename_title` | 5/5 | **0/5** | Structured one UNO `set_text`. Vision clicked/screenshotted; `type` often `missing_target`. Title stayed `"Quarterly Review"`. Slides Gemini vision was 5/5. |
| `recolor_accent` | 5/5 | 1/5 spread | Structured one `set_fill` to `#2f6f5f` (UNO). Vision 1/5 typed after right-click; 4/5 `type` `missing_target`, fill stayed `#e6a23c`. |
| `add_callout` | 5/5 | 1/5 spread | Structured one `create_shape` (`rect_4`). Vision 1/5 created a rectangle; 4/5 clicked the synthetic toolbar and missed. |

Named fill and create are still hard for vision. On live Impress, **visible title text is also a vision miss** for this model. That is not a structured-IR failure.

### Gated — structured 16/25, vision 10/25

Read the “reading” column. Grader `DONE` is the final-state check only.

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `recolor_locked_logo` | 0/5 | 0/5 | **Cannot be `DONE`.** Policy `report_failed`. Structured unlocked then filled (`#2f6f5f`) every repeat. Vision never changed the teal (`#8fd0c4`). Zero is the policy. |
| `edit_hidden_slide` | 5/5 | 0/5 | Channel split on the **body text**. Structured: `describe`/`state` → `set_active_slide` → `set_text`. Vision 0/5 on `"Shown now"`. Several vision runs did activate `slide_02` via synthetic scroll, then `type` `missing_target`. That is not a hidden-state read; it is a click/type miss on the second page. |
| `recover_title` | 5/5 | 5/5 | **False pass, both policies.** Fixture already is `"Quarterly Review"`. `usedRecovery=false`. Structured: 4/5 `set_text` to the current title (empty effects); 1/5 zero steps. Vision never restored from `"Oops"`. |
| `abort_rebrand` | 1/5 spread | 5/5 | Structured **0/5 real abort**. The 1/5 grader `DONE` is inaction (`scir.transaction` `unknown_operation` with `impress__set_text`, then `describe`). 4/5 unlocked the logo and applied the rebrand. Vision **5/5 inaction** (`type` `missing_target`). Not an atomic abort. |
| `host_drift` | 5/5 | 0/5 | **Clean gated recovery on structured.** All 5: `set_text` → `set_fill` `host_diverged` → `sync` → retry. `usedSync=true`, `hostDiverged=1`. Goal checks read the live UNO title `"Recovered"` / `#2f6f5f`. Vision never reached `"Recovered"` (`hostDiverged=0`), so the inject never fired. |

Mechanism-true gated counts (not the grader): structured **10/25**, vision **0/25**.

- structured 10 = hidden 5 + drift 5
- abort 0 (the one grader win is inaction; the other four applied)
- vision 0 = no hidden-slide body edit, no undo, no atomic abort, no sync

Slides Gemini mechanism-true gated was 13/25 vs 0/25 (the extra 3 were real structured aborts).

### Vision-favorable — structured 5/5, vision 4/5 spread

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `contrast_check` | 5/5 | 4/5 spread | Structured one `set_fill` on `bg_01` (IR-canvas WCAG ~12.14:1). Vision 4/5 typed a dark blue after right-click; 1/5 stopped after right-click (1.07:1). **Verdict is the frozen IR canvas raster, not the LibreOffice PNG.** Scripted structured on this host was 0/5 (known WCAG miss); live structured did not repeat that miss. |

## What this measures

Same frozen v4 protocol as the slides Gemini 90-run. Same model for structured and vision. Structured catalog is Impress domain ops (`set_text`, `set_fill`, `create_shape`, `set_active_slide`) plus `undo`/`sync`. Vision gets a LibreOffice page PNG with a **synthetic** toolbar pad, then click/type/scroll/right_click mapped into millimetres.

It does **not** measure PowerPoint, Blender, Krita, a real Impress GUI, or a product decision on locked targets. It does **not** license treating 36/45 vs 16/45 as “IR wins on LibreOffice.”

## Limitations (do not bury)

1. Previous Gemini/Qwen/Haiku 90-runs used an **in-memory slides** adapter. This run is a live Impress process. Do not average them.
2. `recover_title` 5/5 vs 5/5 is a **start-state false pass**.
3. `recolor_locked_logo` 0/5 vs 0/5 is the **policy**, not an IR miss. Structured still unlocked then filled.
4. Recovery is only for state the adapter exposes. This adapter’s snapshot rewrite is the exposed IR graph, not an arbitrary `.odp` binary rollback.
5. Vision chrome is **synthetic**. Host PNG thumbnails in the logs are ~96×54 before padding. `type` after `click` often returns `missing_target`. That is an adapter/render + fake-UI limit, not a reason to change v4 scoring.
6. `contrast_check` still grades the IR canvas, as frozen. A host PNG that disagreed with IR fill would not change the verdict.

## Findings worth keeping

1. **Structured execution and `host_drift` survive contact with LibreOffice.** One-step `set_text` / `set_fill` / `create_shape`, and the `host_diverged` → `sync` → retry path, match the slides Gemini traces on a real `.odp`.
2. **Hidden-slide body text is still a channel split.** Vision never wrote `"Shown now"`. Reaching `slide_02` via synthetic scroll is not the gated skill.
3. **Vision execution got harder, not easier, on the live host.** Title rename went from 5/5 (slides) to 0/5 (Impress) for the same model. Treat that as the screenshot channel + tiny export + fake chrome, not as “Impress cannot be renamed.”
4. **`abort_rebrand` is still a model choice on the same tools.** Here Gemini structured usually unlocked and applied (1/5 inaction). Slides Gemini often stopped or rolled back. Do not enlarge the common core for `impress__set_text` `unknown_operation`.
5. **No task was skipped.** Incompatibilities that showed up are grader-false-passes, policy zeros, and vision click/type misses — not missing Impress operations for this task set.

## Protocol

v4 stays frozen. Scoring was not changed. The common IR core was not expanded. `set_text` remains an Impress/slides domain op.

Do not change `host_drift`, prompts, or scoring to chase a higher Impress vision rate.
