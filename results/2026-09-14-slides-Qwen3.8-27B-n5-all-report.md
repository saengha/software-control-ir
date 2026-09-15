# Live 90-run (v4, frozen) — Qwen3.8-27B

- protocol: `scir-compare-v0` **v4**
- driver: live
- model: `Qwen3.8-27B` (same model for both policies; local vLLM, BF16, no weight quant)
- adapter: **slides** (in-memory, not Impress)
- repeats: N=5
- size: 9 tasks × 2 policies × 5 = **90**
- when: started `2026-09-14T13:35:29Z`, finished `2026-09-15T00:56:14Z` (crash + resume; jsonl is complete)
- command: `npx tsx examples/compare.ts --repeats=5 --adapter=slides` with `SCIR_COMPARE_PROVIDER=openai` `SCIR_COMPARE_BASE_URL=http://127.0.0.1:8000/v1` `SCIR_COMPARE_MODEL=Qwen3.8-27B`
- logs: [2026-09-14-slides-Qwen3.8-27B-n5-all.md](2026-09-14-slides-Qwen3.8-27B-n5-all.md), [2026-09-14-slides-Qwen3.8-27B-n5-all.json](2026-09-14-slides-Qwen3.8-27B-n5-all.json), [2026-09-14-slides-Qwen3.8-27B-n5-all.jsonl](2026-09-14-slides-Qwen3.8-27B-n5-all.jsonl)
- paired Gemini run: [2026-09-13-slides-gemini-3.6-flash-n5-all-report.md](2026-09-13-slides-gemini-3.6-flash-n5-all-report.md)

Do not lead with the combined rate. Gated tasks are structurally easier for structured. Several grader `DONE`s are “left the start state alone,” not recovery.

Machine table (grader): structured **35/45**, vision **19/45**. That number is not the finding. Gemini on the same protocol was 40/45 vs 19/45.

## Category tables (grader)

### Execution — structured 15/15, vision 11/15

Gemini on the same tasks: 15/15 vs 6/15. Qwen vision is stronger on fill and create, weaker on title text.

| Task | structured | vision | What the traces show |
| --- | --- | --- | --- |
| `rename_title` | 5/5 | 3/5 spread | Structured 1–2 steps (`set_text`; two runs wasted a `scir.transaction` with `malformed_action`). Vision 3/5 typed `"Board Update"`; 2/5 clicked/right-clicked for 8 steps and never typed. Gemini vision was 5/5. |
| `recolor_accent` | 5/5 | 3/5 spread | Structured one `set_fill` (or a rejected transaction then `set_fill`). Vision 3/5 typed `#2f6f5f` after right-click; 2/5 never typed. Gemini vision was 0/5. |
| `add_callout` | 5/5 | **5/5** | Structured one `create_shape`. Vision all 5: click toolbar `y=-18` then the canvas, created `rect_7` (r4 also `rect_8`). Gemini vision was 1/5. Native VLM found the rectangle tool that Gemini missed. |

Visible text rename is no longer a tie. Named fill and creating a shape are where Qwen vision beats Gemini vision.

### Gated — structured 15/25, vision 6/25

Read the “reading” column. Grader `DONE` is the final-state check only.

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `recolor_locked_logo` | 0/5 | 0/5 | **Cannot be `DONE`.** `LOCKED_TARGET_POLICY=report_failed`. Structured unlocked then filled (`#2f6f5f`) on every repeat. Vision never changed the teal (`#8fd0c4`). Zero is the policy, not “IR cannot see locks.” Same pattern as Gemini. |
| `edit_hidden_slide` | 5/5 | 0/5 | Clean gated split. Structured: `scir.state` / `describe` → `set_active_slide` → `set_text` (one run also `create_shape` then `sync`). Vision never left `slide_01`. Same split as Gemini. |
| `recover_title` | 5/5 | 5/5 | **False pass, both policies.** Fixture already is `"Quarterly Review"`. `usedRecovery=false` on every repeat. Structured: 4/5 `set_text` to the current title; 1/5 `scir.state` only. Vision: 4/5 never typed; 1/5 typed `"Quarterly Review"`. Do not treat 5/5 vs 5/5 as undo skill. |
| `abort_rebrand` | 0/5 | 1/5 spread | Structured **0/5 abort**. Every structured run unlocked `logo_01` and applied the rebrand (direct `set_*` or `scir.transaction` after unlock). Title ended `"Rebranded"`, accent `#2f6f5f`. r3 rolled back one stale transaction (`recovery=snapshot`) then still applied the three edits. Vision **1/5 inaction** (r3 never typed `Rebranded`); **4/5 left the title as `Rebranded`**. Gemini structured was 5/5 grader (3 real undo/rollback + 2 inaction). Qwen did the opposite: it finished the rebrand. |
| `host_drift` | 5/5 | 0/5 | **Clean gated recovery on structured.** All 5: `set_text` → `set_fill` `host_diverged` → `sync` → retry. `usedSync=true`, `hostDiverged=1`. Vision 0/5. Unlike Gemini vision (inject never fired), Qwen vision **2/5** typed `"Recovered"` and took the inject (`hostDiverged=4`, title left `"Out of band"`). Those runs test “vision after drift” and still fail: no `sync`. 3/5 never reached `"Recovered"`. |

Mechanism-true gated counts (not the grader): structured **10/25**, vision **0/25**.

- structured 10 = hidden 5 + drift 5
- abort 0 (applied the rebrand instead of leaving the document unchanged)
- vision 0 = no hidden-slide edit, no undo, no atomic abort, no sync

Gemini mechanism-true gated was 13/25 vs 0/25 (the extra 3 were real structured aborts).

### Vision-favorable — structured 5/5, vision 2/5 spread

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `contrast_check` | 5/5 | 2/5 spread | Structured one `set_fill` on `bg_01` to a dark blue (ratios ~14–20:1). Vision 2/5 typed `#1a2a5e` / `#1a3a5c` and passed WCAG; 3/5 never changed the light background (1.07:1). Gemini vision was 5/5. This category is not a structured “win” on Gemini and is not a vision win on Qwen. |

## What this measures

Same frozen v4 protocol as the Gemini 90-run. Same model for structured and vision. Structured gets the catalog + `undo` + `sync`. Vision gets PNG + click/type/scroll/right_click. Vision tool results do not carry lock flags or object ids.

The local serve is BF16 Qwen3.8-27B on 2×3090 with prefetch CPU offload, `--max-model-len 8192`. The client keeps only the latest screenshot (vLLM image cap 4) and requests 1024 output tokens on localhost so a long structured trace does not exceed 8192. That is serving hygiene, not a protocol change.

It does **not** measure Impress, GPT, Claude, or a product decision on locked targets.

## Findings worth keeping

1. **Qwen vision closes Gemini’s fill/create gap and opens a title gap.** `add_callout` 5/5 vs Gemini 1/5. `recolor_accent` 3/5 vs 0/5. `rename_title` 3/5 vs Gemini 5/5. Native VLM is not a uniform vision upgrade.
2. **Hidden state is still a real channel difference.** `edit_hidden_slide` 5/5 vs 0/5, same as Gemini.
3. **`host_drift` structured is still the clean recovery result.** Same `host_diverged` → `sync` → retry as Gemini. Qwen vision 2/5 actually reached the inject and then stalled on `"Out of band"` — closer to the gated test than Gemini vision, still 0/5.
4. **`recover_title` 5/5 vs 5/5 is a start-state pass.** `usedRecovery=false`. Same caveat as Gemini.
5. **`abort_rebrand` is the model difference.** Gemini structured often stopped or rolled back when the logo was locked. Qwen structured unlocked the logo and completed the rebrand (0/5 grader). That is not an IR failure; the tools allowed it. The grader wants the document left unchanged if any edit cannot apply.
6. **`recolor_locked_logo` 0/5 vs 0/5 is the policy.** Structured still unlocked then filled. Changing the policy would change the number.
7. **`scir.transaction` naming is still a tax.** `malformed_action` / `unknown_operation` (`slides__set_text`) showed up on rename, recover, and abort. Apply still worked via catalog actions. Do not enlarge the common core to paper over the name.
8. **Live `contrast_check` is not a Qwen vision win.** 2/5 vs Gemini 5/5. Do not cite the scripted structured miss as if either live model repeated it.

## Protocol

v4 stays frozen. Do not change `host_drift`, prompts, or scoring to chase a higher rate.

Next optional measurement: the same live protocol against GPT / Claude APIs, or Impress (`--adapter=impress`), not a redesigned task set.
