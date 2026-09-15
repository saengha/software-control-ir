# Software Control IR

Software already knows what it is. AI shouldn't have to figure it out from a screenshot.

An experimental semantic intermediate representation for AI-controlled software. Not a standard, not an MCP replacement, not a universal command language.

The question:

> Can a small semantic layer make AI-controlled software more predictable, inspectable, and recoverable than screenshots or unrestricted application-specific code?

This repository measures that question against a frozen protocol (`scir-compare-v0` **v4**) and against a live LibreOffice Impress process.

## 1. Problem

Agents already drive software in two common ways:

```
Screenshot → Vision → Mouse / Keyboard
```

```
LLM → Code → Application API
```

Both work. Both spend inference on facts the application already knows: which objects exist, which one is the target, whether it is locked, what changed, whether the call succeeded.

That cost is not only tokens. It is another chance to be wrong, and another opaque trace when something goes wrong.

## 2. Software Control IR

The application exposes structured state. The agent selects a structured action. An adapter translates to the native API.

```
Application
    ↓
Structured state
    ↓
Software Control IR
    ↓
AI agent
    ↓
Structured action
    ↓
Adapter
    ↓
Application
```

The model is not asked to discover `title_01` from pixels. It is given a state and asked to pick an operation against that state.

This is an intermediate layer, not a product surface. MCP, OpenAPI, and native APIs can still carry or implement it. Domain operations stay on adapters. The common core is `select`, `set_locked`, and `delete`.

## 3. State → Action → Validation → Result → Recovery

```
State
  ↓
Action
  ↓
Precondition / validation
  ↓
Effect
  ↓
Revision
  ↓
Recovery (named)
```

**State.** IDs, geometry, text, fill, lock, active slide — whatever the adapter marks as relevant. Not necessarily the whole document.

**Action.** A named operation plus target and params. `set_text` on Impress is millimetre-space slide text, not a universal command.

**Validation.** Invalid actions are rejected before the adapter mutates. A locked logo fill fails with `locked` before UNO is called.

**Result.** Every accepted action reports effects and a revision. The live Impress path re-reads the document through UNO (`adapter.snapshot()`), not from `ActionResult.effects` alone.

**Recovery.** The result says which mechanism ran:

```
compensation  → inverse action, history moves forward
snapshot      → restore recorded state; advertised only when the adapter can overwrite the host
```

A host can also change out of band. Further actions return `host_diverged` until an explicit `sync`. That path is the representative measurement below, not `recover_title`.

A batch either lands or leaves no changes. If a prefix cannot be inverted, the adapter says `dirty_state` instead of claiming atomicity.

## 4. Architecture

```
AI agent
    ↓
Transport (MCP can sit here later)
    ↓
Software Control IR  (Session: validate, apply, sync, undo)
    ↓
Adapter
    ↓
Existing software
```

| Adapter | Host | Role |
| --- | --- | --- |
| **lab** | In-memory heater / vessel | Original fixture |
| **slides** | In-memory deck | Software-shaped surface for the frozen compare protocol. Not PowerPoint |
| **impress** | Live LibreOffice over UNO | First real-application measurement of the same protocol |
| **blender** / **krita** | Live `bpy` / PyKrita | Same Adapter / Session contract, different catalogs. Not in compare v4 |

Impress domain ops (`set_text`, `set_fill`, `create_shape`, `set_active_slide`, millimetre `move` / `resize`) live on the Impress adapter. They are not in the common core.

The catalog can be projected as typed tool descriptors. Tool names on the wire may rewrite `.` to `__` (`impress.set_text` → `impress__set_text`). That is transport. The IR operation remains `set_text` on the adapter. Do not enlarge the core to paper over the wire name.

Accessibility trees and screenshots remain complementary. The IR is “what state and operations the software exposes,” not “what is painted.”

## 5. Live LibreOffice Impress validation

This is the contact-with-software result, not an appendix.

The reproducible validation record (environment, smoke, 90-run, `host_drift` traces, artifact provenance) is [docs/live-impress-validation.md](docs/live-impress-validation.md). The same frozen v4 protocol ran on a real Impress host, including UNO state checks and recovery after drift.

A real headless `soffice` process is started with a **private** `UserInstallation` (`scir-lo-*`), not the desktop LibreOffice profile. Node talks JSON to `src/adapters/impress/bridge.py`; the bridge talks UNO to the open `.odp`.

```
TypeScript Adapter → Python UNO bridge → LibreOffice Impress → live document
```

Committed fixtures: `fixtures/impress/board.odp`, `fixtures/impress/contrast.odp`. Tests copy them; they do not write the repository files.

If LibreOffice is missing, `ImpressAdapter.available()` is false, live tests **skip**, and `npx tsx examples/compare.ts --adapter=impress` **exits 2**. It does not fall back to the in-memory slides adapter, and it does not report a scripted run as live.

What was verified on this machine (LibreOffice **26.8.0.3**, Windows 10.0.26100):

1. **Host smoke.** `set_text` on `title_01` is visible in a **fresh UNO snapshot**, not only in `ActionResult`. Save, close, reopen keeps the text.
2. **Conformance.** The shared Adapter checks pass against the live `.odp` (compensation undo; snapshot restore of the **exposed** IR graph).
3. **Scripted v4.** Frozen scripts, driver=`scripted`, host=real Impress. Confirms the grader on UNO state. Not a model.
4. **Live v4 90-run.** Same frozen protocol, `gemini-3.6-flash` for both policies, N=5, 9×2×5=90, none skipped. Logs label `adapter=impress`, `driver=live`. Goal checks read the live document.

Vision in that 90-run still uses a **synthetic toolbar overlay** on a host page PNG. It is not an Impress UI benchmark. `contrast_check` is still graded from the frozen **IR canvas raster**, not from the LibreOffice PNG.

Writeup: [results/2026-09-15-impress-gemini-3.6-flash-n5-all-report.md](results/2026-09-15-impress-gemini-3.6-flash-n5-all-report.md). Environment: [results/2026-09-15-impress-gemini-3.6-flash-n5-all-env.json](results/2026-09-15-impress-gemini-3.6-flash-n5-all-env.json).

## 6. Benchmark results

Protocol `scir-compare-v0` **v4, frozen**. Same natural-language goals, same step budget, same model for structured and vision. Structured gets the catalog + `undo` + `sync`. Vision gets PNG + click / type / scroll / right_click, without object IDs or lock flags.

Nine tasks: execution (`rename_title`, `recolor_accent`, `add_callout`), gated (`recolor_locked_logo`, `edit_hidden_slide`, `recover_title`, `abort_rebrand`, `host_drift`), vision-favorable (`contrast_check`). Do not lead with a combined win rate. Gated tasks are structurally easier for structured.

These two experiments are **not** the same environment. Do not average them.

### Experiment A — in-memory slides

- **Host:** `slides` adapter (memory). Not LibreOffice, not PowerPoint.
- **Vision:** synthetic canvas + synthetic chrome.
- **Contrast grader:** IR canvas raster.
- **Repeats:** N=5 (90 runs per model).
- **Models:** `gemini-3.6-flash`, local `Qwen3.8-27B`, `claude-haiku-4-5-20251001` (each model used for both policies).

Writeups: [Gemini](results/2026-09-13-slides-gemini-3.6-flash-n5-all-report.md), [Qwen](results/2026-09-14-slides-Qwen3.8-27B-n5-all-report.md), [Haiku](results/2026-09-15-slides-claude-haiku-4-5-20251001-n5-all-report.md).

Category totals (structured / vision):

| | Gemini | Qwen | Haiku |
| --- | --- | --- | --- |
| Execution (15) | 15 / 6 | 15 / 11 | 15 / 8 |
| Gated grader (25) | 20 / 8 | 15 / 6 | 15 / 10 |
| Mechanism-true gated (25) | 13 / 0 | 10 / 0 | 10 / 0 |
| Vision-favorable (5) | 5 / 5 | 5 / 2 | 5 / 5 |

Mechanism-true gated counts a hidden-slide body edit, an abort that undid after a mutation, and a `host_drift` that synced and retried. Vision is 0/25 on that reading for every model here.

What repeats across three models: hidden state and `host_drift` are channel differences. `recover_title` 5/5 vs 5/5 is a **start-state pass** (`usedRecovery=false`). `recolor_locked_logo` 0/5 vs 0/5 is `LOCKED_TARGET_POLICY=report_failed`, not “IR cannot see locks” (structured still unlocked then filled). Vision holes **move** (Gemini fill/create; Haiku title typing). `abort_rebrand` is a model choice on the same tools.

### Experiment B — live LibreOffice Impress

- **Host:** real headless LibreOffice 26.8.0.3, private profile, UNO snapshot of a copied `.odp`.
- **Vision:** LibreOffice page PNG + **synthetic** toolbar. Not the Impress GUI.
- **Contrast grader:** frozen IR canvas raster (host PNG is not the verdict).
- **Repeats:** N=5 (90 runs). None skipped.
- **Model:** `gemini-3.6-flash` for both policies.
- **Command:** `npx tsx examples/compare.ts --repeats=5 --adapter=impress`

Writeup: [Impress Gemini](results/2026-09-15-impress-gemini-3.6-flash-n5-all-report.md).

| Category | structured | vision |
| --- | --- | --- |
| Execution (15) | 15 | 2 |
| Gated grader (25) | 16 | 10 |
| Mechanism-true gated (25) | 10 | 0 |
| Vision-favorable (5) | 5 | 4 |

| Task | structured | vision | Reading |
| --- | --- | --- | --- |
| `rename_title` | 5/5 | 0/5 | Structured one UNO `set_text`. Vision `type` often `missing_target`. |
| `recolor_accent` | 5/5 | 1/5 | Structured UNO `set_fill`. |
| `add_callout` | 5/5 | 1/5 | Structured `create_shape`. |
| `recolor_locked_logo` | 0/5 | 0/5 | **Policy.** Cannot be `DONE` under `report_failed`. Structured unlocked then filled. |
| `edit_hidden_slide` | 5/5 | 0/5 | Structured edited `body_02`. Vision never wrote `"Shown now"`. |
| `recover_title` | 5/5 | 5/5 | **Not recovery.** Fixture already `"Quarterly Review"`. `usedRecovery=false`. |
| `abort_rebrand` | 1/5 | 5/5 | Structured 1/5 is inaction; 4/5 applied. Vision 5/5 is inaction. |
| `host_drift` | 5/5 | 0/5 | Structured sync/retry on the live document (see below). Vision never reached `"Recovered"`. |
| `contrast_check` | 5/5 | 4/5 | IR-canvas WCAG, not a LibreOffice PNG grade. |

Structured execution and the drift path ran on a real `.odp`. Vision numbers here measure synthetic chrome plus a small host PNG, not “the model used Impress.”

## 7. `host_drift` recovery example

This is the case that shows state verification and recovery against software the IR does not own.

Shared goal (no mention of drift or sync in the prompt):

> Change the title to "Recovered" and set its fill to #2f6f5f.

After the title first becomes `"Recovered"`, the harness writes `"Out of band"` through the adapter (`execute`, not the agent). The next apply must see `host_diverged`. Structured `DONE` requires that divergence, an accepted `sync`, a retry of title/fill after sync, and a UNO snapshot that actually holds `"Recovered"` / `#2f6f5f`.

On live Impress, Gemini structured did this on all five repeats:

```
set_text title_01 "Recovered"     accepted
set_fill title_01 #2f6f5f         rejected  host_diverged
sync                              accepted
set_text title_01 "Recovered"     accepted
set_fill title_01 #2f6f5f         accepted
```

```
host snapshot (UNO)
  title_01.text = "Recovered"
  title_01.fill = #2f6f5f
usedSync = true
hostDiverged = 1
```

That is the IR loop: detect that the host moved, refuse to keep writing, require an explicit sync, then verify the document — not the tool-result payload.

Vision has no `sync`. In this Impress run it never produced `"Recovered"`, so the inject never fired (`hostDiverged=0`). That is the expected gated miss for this observation channel, not a claim that screenshots can recover from host edits.

The same structured sequence appeared on the in-memory slides Gemini/Qwen/Haiku runs. The Impress run is the one that did it on a live soffice document.

`recover_title` is **not** this story. Its 5/5 vs 5/5 is the start state already being `"Quarterly Review"`.

## 8. Limitations

- This is an experiment. It is not a replacement for MCP, OpenAPI, application APIs, GUI automation, or a finished industry standard. It does not claim vision agents are obsolete.
- **In-memory slides ≠ live Impress.** Do not treat those 90-runs as one table.
- Vision never used the real Impress UI. Chrome is a **synthetic toolbar** painted onto a screenshot.
- `contrast_check` grades the **IR canvas**, as frozen in v4. A LibreOffice PNG that disagreed would not change the verdict.
- `recover_title` 5/5 is a **false pass** for recovery skill.
- `recolor_locked_logo` 0/5 is a **product policy** (`report_failed`), not an IR blindness to locks.
- Recovery only covers state the adapter exposes. Impress snapshot restore rewrites that graph; it is not a binary `.odp` time machine. Krita pixels and Blender meshes are not in their restore spaces.
- Impress vision screenshots in the live 90-run were small host PNGs (~96×54 before padding). `type` after `click` often returned `missing_target`. That is adapter/render + fake UI, not a reason to unfreeze v4.
- `scir.transaction` with `impress__set_text` / `slides__set_text` is `unknown_operation`. Apply still works via catalog actions. Do not grow the common core for the wire name.
- Blender and Krita are conformance hosts, not compare v4.

## 9. Roadmap

- [x] Minimal IR: state, action, validation, effect, revision, named recovery
- [x] `Session` validates before mutate; host-owned drift + `sync`; atomic batches
- [x] Lab and in-memory slides adapters
- [x] LibreOffice Impress adapter (live UNO, private profile)
- [x] Frozen compare protocol v4 and a live model loop
- [x] Three same-protocol 90-runs on in-memory slides (Gemini, Qwen, Haiku)
- [x] Same frozen protocol on live Impress (Gemini), after scripted + one-task smoke
- [x] Blender / Krita adapters for the shared conformance suite (not v4)
- [ ] Optional: another slides model — not required to read the tables above
- [ ] Refine the IR from these measurements (do not unfreeze v4 to chase a rate)

v4 stays frozen. Do not change `host_drift`, prompts, or scoring to chase a higher number. Do not clone these nine tasks onto Blender or Krita.

## What this is not

- A replacement for MCP, OpenAPI, or application APIs
- A GUI automation framework
- A universal command language
- A claim that vision-based agents are obsolete
- A finished industry standard

## Run it

```bash
npm install
npm test
npm run typecheck
npm run example:impress
npm run conformance
npm run compare:scripted
npx tsx examples/compare.ts --scripted --adapter=impress
```

Copy `.env.example` to `.env`. Live compare needs `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / a local OpenAI-compatible server. Both policies must share `SCIR_COMPARE_MODEL`. This Windows npm does not forward `npm run compare -- --flags`; use the named scripts or `npx tsx examples/compare.ts ...`.

`npm run example:impress` starts headless LibreOffice, opens `fixtures/impress/board.odp`, and runs `set_text` against the live document. Set `SCIR_LIBREOFFICE` if LibreOffice is not in `C:\Program Files\LibreOffice\program`. Direct `soffice.bin` is not the entry point.

Task catalog: `docs/tasks.md`. Log schema: `schema/experiment.v2.json`.

## License

TBD

## Contributing

Early experimentation, discussion, and implementations are welcome. The useful work is still contact with real software and honest measurement of where the IR holds — and where it does not.
