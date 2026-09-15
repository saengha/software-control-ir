# Live 90-run (v4, frozen)

- protocol: `scir-compare-v0` **v4**
- driver: live
- model: `gemini-3.6-flash` (same model for both policies)
- adapter: **slides** (in-memory, not Impress)
- repeats: N=5
- size: 9 tasks × 2 policies × 5 = **90**
- when: `2026-09-13T15:41:13.761Z` (KST 2026-09-14)
- command: `npx tsx examples/compare.ts --repeats=5 --adapter=slides` (`npm run compare:90`)
- logs: [2026-09-13-slides-gemini-3.6-flash-n5-all.md](2026-09-13-slides-gemini-3.6-flash-n5-all.md), [2026-09-13-slides-gemini-3.6-flash-n5-all.json](2026-09-13-slides-gemini-3.6-flash-n5-all.json)

Do not lead with the combined rate. Gated tasks are structurally easier for structured. Several grader `DONE`s are “left the start state alone,” not recovery.

Machine table (grader): structured **40/45**, vision **19/45**. That number is not the finding.

## Category tables (grader)

### Execution — structured 15/15, vision 6/15

| Task | structured | vision | What the traces show |
| --- | --- | --- | --- |
| `rename_title` | 5/5 | 5/5 | Both reach `"Board Update"`. Structured 1 step (`set_text`). Vision 5 steps (`screenshot` → `click` → `type` → extra chrome). |
| `recolor_accent` | 5/5 | 0/5 | Structured one `set_fill` to `#2f6f5f`. Vision right-clicks the gold bar and stops; fill stays `#e6a23c`. |
| `add_callout` | 5/5 | 1/5 spread | Structured one `create_shape`. Vision mostly misses the rectangle tool (`y=-18` / toolbar clicks). One run created `rect_7`. |

Visible text rename is not the gap. Named fill and creating a shape are.

### Gated — structured 20/25, vision 8/25

Read the “reading” column. Grader `DONE` is the final-state check only.

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `recolor_locked_logo` | 0/5 | 0/5 | **Cannot be `DONE`.** `LOCKED_TARGET_POLICY=report_failed` makes `lockedTargetFillAccepted` always false. Structured unlocked then filled (`#2f6f5f`). Vision never changed the teal (`#8fd0c4`). Zero here is the policy, not “IR cannot see locks.” |
| `edit_hidden_slide` | 5/5 | 0/5 | Clean gated split. Structured: `scir.state` / `describe` → `set_active_slide` → `set_text`. Vision never left `slide_01`; body still the hidden placeholder. |
| `recover_title` | 5/5 | 5/5 | **False pass, both policies.** Fixture already is `"Quarterly Review"`. Structured only called `scir.state` (`usedRecovery=false`). Vision typed `"Quarterly Review"` onto the current title. Nobody restored from `"Oops"`. |
| `abort_rebrand` | 5/5 | 3/5 spread | Structured **3/5 real abort** (undo or `rollback` after a locked logo fill), **2/5 inaction** (`scir.transaction` rejected as `unknown_operation` with `slides__set_text`, then `describe`). Vision **3/5 inaction** (never typed `Rebranded`), **2/5 left the title as `Rebranded`**. |
| `host_drift` | 5/5 | 0/5 | **Clean gated recovery.** Structured all 5: `set_text` → `set_fill` `host_diverged` → `sync` → retry. `usedSync=true`, `hostDiverged=1`. Vision never made the title `"Recovered"`, so the inject never fired (`hostDiverged=0`). |

Mechanism-true gated counts (not the grader): structured **13/25**, vision **0/25**.

- structured 13 = hidden 5 + abort 3 + drift 5
- vision 0 = no hidden-slide edit, no undo, no atomic abort, no sync

### Vision-favorable — structured 5/5, vision 5/5

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `contrast_check` | 5/5 | 5/5 | Both pick a WCAG-passing dark blue on the raster (ratios ~10–15:1). Live structured did **not** reproduce the scripted split (the frozen script can succeed in IR and fail WCAG). This category is not a structured win. |

## What this measures

Same model, same goals, same step budget, frozen prompt text (no recovery hints). Structured gets the catalog + `undo` + `sync`. Vision gets PNG + click/type/scroll/right_click. Vision tool results do not carry lock flags or object ids.

It does **not** measure Impress, other models, or a product decision on locked targets.

## Findings worth keeping

1. **Execution gap is fill and create, not title text.** `rename_title` ties. `recolor_accent` and `add_callout` do not.
2. **Hidden state is a real channel difference.** `edit_hidden_slide` is the cleanest gated execution result in this run.
3. **`host_drift` is the cleanest recovery result.** Matches the v4 freeze check. Structured saw `host_diverged`, synced, retried, finished both edits. Vision never reached the first required edit, so this run does not even test “vision after drift.”
4. **`recover_title` and part of `abort_rebrand` grade the start state.** Final `"Quarterly Review"` / untouched accent is true at t=0. Live agents that inspect and stop get `DONE`. Frozen scripts would have mutated first. Do not treat 5/5 vs 5/5 on `recover_title` as undo skill.
5. **`recolor_locked_logo` 0/5 vs 0/5 is the policy.** Structured used `set_locked` then `set_fill` (the `unlock_and_apply` script). The grader still fails. Changing the policy would change the number; that is a product decision, not a protocol tweak for a higher rate.
6. **`scir.transaction` with `slides__set_text` is `unknown_operation`.** Several abort/drift runs wasted a step on that. Apply still worked via catalog actions. Do not enlarge the common core to paper over the name.
7. **Live `contrast_check` is a tie.** Do not cite the scripted structured miss as if the live model repeated it.

## Protocol

v4 stays frozen. Do not change `host_drift`, prompts, or scoring to chase a higher rate.

Next optional measurement: the same live protocol against Impress (`--adapter=impress`), not a redesigned task set.
