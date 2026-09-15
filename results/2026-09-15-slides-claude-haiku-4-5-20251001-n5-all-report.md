# Live 90-run (v4, frozen) — claude-haiku-4-5-20251001

- protocol: `scir-compare-v0` **v4**
- driver: live
- model: `claude-haiku-4-5-20251001` (same model for both policies)
- adapter: **slides** (in-memory, not Impress)
- repeats: N=5
- size: 9 tasks × 2 policies × 5 = **90**
- when: started `2026-09-15T09:31:37Z`, finished `2026-09-15T09:44:14Z` (~12.6 min)
- command: `npx tsx examples/compare.ts --repeats=5 --adapter=slides` with `SCIR_COMPARE_PROVIDER=anthropic` `SCIR_COMPARE_MODEL=claude-haiku-4-5-20251001`
- logs: [2026-09-15-slides-claude-haiku-4-5-20251001-n5-all.md](2026-09-15-slides-claude-haiku-4-5-20251001-n5-all.md), [2026-09-15-slides-claude-haiku-4-5-20251001-n5-all.json](2026-09-15-slides-claude-haiku-4-5-20251001-n5-all.json)
- paired runs: [Gemini](2026-09-13-slides-gemini-3.6-flash-n5-all-report.md), [Qwen3.8-27B](2026-09-14-slides-Qwen3.8-27B-n5-all-report.md)

Do not lead with the combined rate. Gated tasks are structurally easier for structured. Several grader `DONE`s are “left the start state alone,” not recovery.

Machine table (grader): structured **35/45**, vision **23/45**. That number is not the finding. Gemini was 40/45 vs 19/45. Qwen was 35/45 vs 19/45.

## Category tables (grader)

### Execution — structured 15/15, vision 8/15

Gemini 15/15 vs 6/15. Qwen 15/15 vs 11/15. Haiku vision matches Qwen on fill/create and is the worst of the three on title text.

| Task | structured | vision | What the traces show |
| --- | --- | --- | --- |
| `rename_title` | 5/5 | **0/5** | Structured one `set_text`. Vision never typed: click/screenshot until the budget. Title stayed `"Quarterly Review"`. Gemini vision 5/5, Qwen 3/5. |
| `recolor_accent` | 5/5 | 3/5 spread | Structured `set_fill` (sometimes after `select`). Vision 3/5 typed `#2f6f5f`. One miss typed `2f6f5f` without `#`. Gemini vision 0/5, Qwen 3/5. |
| `add_callout` | 5/5 | **5/5** | Structured one `create_shape`. Vision all 5: toolbar `(24,-18)` then canvas, `rect_7`. Same as Qwen. Gemini vision 1/5. |

Visible text rename is the gap. Named fill and creating a shape are not.

### Gated — structured 15/25, vision 10/25

Read the “reading” column. Grader `DONE` is the final-state check only.

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `recolor_locked_logo` | 0/5 | 0/5 | **Cannot be `DONE`.** Structured unlocked then filled (`#2f6f5f`) every repeat. Vision never changed the teal (`#8fd0c4`). One vision run invented `left_click`. Zero is the policy. Same pattern as Gemini and Qwen. |
| `edit_hidden_slide` | 3/5 spread | 0/5 | **Not a clean 5/5.** 3/5: `scir.state` → `set_active_slide` → `set_text`. 2/5: `scir.state` + `scir.describe` then stop — they saw the hidden slide and did not edit it. Vision never left `slide_01`. Gemini/Qwen structured were 5/5. |
| `recover_title` | 5/5 | 5/5 | **False pass.** Fixture already is `"Quarterly Review"`. `usedRecovery=false`. Structured: 4/5 `scir.state` only; 1/5 `undo` rejected `nothing_to_undo`. Vision never typed. Do not treat 5/5 vs 5/5 as undo skill. |
| `abort_rebrand` | 2/5 spread | 5/5 | Structured **2/5 real compensation undo** after a title `set_text` (`usedRecovery=true`, `recovery=compensation`). Both then wasted steps on `scir.transaction` with `slides__set_text` (`unknown_operation`). r0 leftover-unlocked `logo_01` after the undo; the grader does not check logo lock. **3/5 applied the rebrand** (r2 one accepted transaction; r3 undid then set again; r4 unlocked and filled). Vision **5/5 inaction** — never typed `Rebranded`. That is a start-state pass, not an atomic abort. Gemini structured grader 5/5 (3 undo + 2 inaction). Qwen structured 0/5 (applied). |
| `host_drift` | 5/5 | 0/5 | **Clean gated recovery on structured.** All 5: `set_text` → `set_fill` `host_diverged` → `sync` → retry (`usedSync=true`, `hostDiverged=1`). Extra `set_fill` after the retry on every run. Vision never reached `"Recovered"` (`hostDiverged=0`), same as Gemini vision. Qwen vision 2/5 did reach the inject. |

Mechanism-true gated counts (not the grader): structured **10/25**, vision **0/25**.

- structured 10 = hidden 3 + abort 2 + drift 5
- vision 0 = no hidden-slide edit, no undo, no atomic abort, no sync

Gemini mechanism-true gated was 13/25 vs 0/25. Qwen was 10/25 vs 0/25 (hidden 5 + drift 5, abort 0).

### Vision-favorable — structured 5/5, vision 5/5

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `contrast_check` | 5/5 | 5/5 | Structured one `set_fill` on `bg_01` (ratios ~8.8–12.6:1). Vision typed a dark blue hex (`#1e3a8a` / `#003d7a` / `#1a3a52`) after right-click. Tie, like Gemini. Qwen vision was 2/5. One vision run invented `triple_click`. |

## What this measures

Same frozen v4 protocol as Gemini and Qwen. Same model for structured and vision. Catalog dots are rewritten to `__` on the wire (`slides.set_text` → `slides__set_text`); several abort transactions still sent `slides__set_text` as the operation name and got `unknown_operation`.

It does **not** measure Sonnet/Opus, Impress, or a product decision on locked targets. Haiku was the $5-budget pick ($1/$5 per MTok).

## Findings worth keeping

1. **Haiku vision does fill and create, not title text.** `add_callout` 5/5 and `recolor_accent` 3/5 match Qwen. `rename_title` 0/5 is worse than Gemini 5/5 and Qwen 3/5. Native screenshots are not a uniform vision upgrade.
2. **Hidden state is still a channel difference, but Haiku structured is not automatic.** 3/5 edited `slide_02`. 2/5 inspected with `scir.state` / `describe` and stopped. Gemini/Qwen structured did not do that.
3. **`host_drift` structured is still the clean recovery result.** Same `host_diverged` → `sync` → retry as Gemini and Qwen. Vision never fired the inject.
4. **`recover_title` 5/5 vs 5/5 is a start-state pass.** The one `undo` was `nothing_to_undo`.
5. **`abort_rebrand` sits between Gemini and Qwen.** 2 real undos, 3 applied the rebrand. Vision 5/5 is inaction. `scir.transaction` + `slides__set_text` is still a tax. Do not enlarge the common core to paper over the name.
6. **`recolor_locked_logo` 0/5 vs 0/5 is the policy.** Structured still unlocked then filled.
7. **Live `contrast_check` is a tie.** Do not cite the scripted structured miss as if Haiku repeated it.

## Protocol

v4 stays frozen. Do not change `host_drift`, prompts, or scoring to chase a higher rate.

Next optional measurement: GPT, a larger Claude, or Impress (`--adapter=impress`), not a redesigned task set.
