# Live LibreOffice Impress validation

Technical record of running frozen compare protocol **v4** against a real LibreOffice Impress process. Written for engineers and contributors. It is not a product pitch.

**The same protocol was executed against a real LibreOffice Impress host, including host-state validation and recovery after drift.**

The headline is that contact, not a win rate.

## 1. Summary

Software Control IR connected to a live headless LibreOffice Impress (`soffice`) process and ran the frozen `scir-compare-v0` **v4** suite without changing:

- the common IR core (`select`, `set_locked`, `delete`)
- the frozen v4 prompts, task set, or scoring
- Impress-specific operations into that core (`set_text`, `set_fill`, `create_shape`, `set_active_slide` stay on the Impress adapter)

What ran:

1. Host smoke and `.odp` round-trip (UNO snapshot, not `ActionResult.effects` alone).
2. Scripted v4 on the live host (grader check; not a model).
3. Live v4 90-run, `gemini-3.6-flash` for **both** structured and vision policies.

Logs label `adapter=impress` and `driver=live`. `--adapter=impress` does not fall back to the in-memory slides adapter.

## 2. Environment

Recorded in [results/2026-09-15-impress-gemini-3.6-flash-n5-all-env.json](../results/2026-09-15-impress-gemini-3.6-flash-n5-all-env.json) at the end of the live 90-run.

| Item | Value |
| --- | --- |
| OS | Windows NT 10.0.26100 (`win32`) |
| LibreOffice | 26.8.0.3 (`bce0998afefdbc355585ca324285661a2170ba77`) |
| Host process | real `soffice.com` / `soffice.bin`, `--headless` |
| Isolation | private `UserInstallation` (`scir-lo-*` temp profile), not the desktop LibreOffice user profile |
| Bridge | `src/adapters/impress/bridge.py` over UNO (`127.0.0.1`, ephemeral port) |
| Board fixture | `fixtures/impress/board.odp` (copied to temp; repository file not written) |
| Contrast fixture | `fixtures/impress/contrast.odp` (same) |
| Protocol | `scir-compare-v0` **v4** (frozen) |
| Adapter | `impress` |
| Driver | `live` |
| Model | **`gemini-3.6-flash`** (both policies). This is the model from `.env` (`SCIR_COMPARE_MODEL` / `SCIR_COMPARE_PROVIDER=gemini`) for this run — **not** the settings.ts fallback `claude-sonnet-4-5`. |
| Repeats | N=5 |
| Size | 9 tasks × 2 policies × 5 = **90** (none skipped) |
| When | started `2026-09-15T11:15:02Z`, finished `2026-09-15T11:42:03Z` (~27 min) |
| git at run | `318e174` (v4 freeze commit). Working tree had additional uncommitted harness/docs; protocol files were not modified. |

Code in `src/bench/compare/settings.ts` still defaults `COMPARE_LIVE_MODEL` to `claude-sonnet-4-5` if the env is unset. Reproduction **must** set Gemini explicitly (see §9). The completed logs and env JSON record `gemini-3.6-flash`.

## 3. Architecture

```
AI agent (Gemini)
    ↓
compare live loop  (scir-compare-v0 v4, unchanged)
    ↓
Session  (validate → apply / sync / undo)
    ↓
ImpressAdapter  (TypeScript)
    ↓
bridge.py  (LibreOffice python.exe, one RPC per call)
    ↓
real soffice  (private UserInstallation)
    ↓
UNO
    ↓
open .odp
    ↓
adapter.snapshot()  → document state used for goal checks
```

Impress-specific operations (`set_text`, `set_fill`, `create_shape`, `set_active_slide`, millimetre `move` / `resize`) are **domain** operations on the Impress adapter. They are not common-core IR. Wire names may appear as `impress__set_text` after `.` → `__` rewriting; that is transport, not a new core op.

## 4. Live smoke test

Two tests in `tests/impress.test.ts` (run only when LibreOffice and `board.odp` are present):

**Fresh UNO snapshot (not `ActionResult.effects`).**

`it("smoke: set_text is visible in a fresh UNO snapshot, not only in ActionResult")`

1. `adapter.snapshot()` → `title_01` is `"Quarterly Review"`.
2. `session.apply({ action: "set_text", target: "title_01", value: "Host smoke" })` → `accepted`.
3. A **new** `adapter.snapshot()` (another UNO RPC) → `title_01` is `"Host smoke"`.

Success is the second snapshot, not the effects array on the apply result.

**Save → close → reopen.**

`it("keeps edited text after save, close, and reopen")`

1. `set_text` to `"Saved to disk"`.
2. `adapter.save` on the temp `.odp`.
3. `close()` (kills only that soffice tree).
4. New `ImpressAdapter` on the same file.
5. UNO snapshot still reads `"Saved to disk"`.

That is persistence in the real document, not a cached Session object.

## 5. Live benchmark

Protocol v4, live driver, adapter `impress`, model `gemini-3.6-flash`, N=5, 90 runs, none skipped.

Machine table (grader `DONE` counts):

- structured: **36/45**
- vision: **16/45**

Those numbers are **not** the finding. Gated tasks are structurally easier for structured. Several `DONE`s are start-state passes (see §8).

**Experiment A** = synthetic / in-memory `slides` adapter (Gemini, Qwen, Haiku 90-runs).  
**Experiment B** = this live LibreOffice / `soffice` 90-run.

**Do not compare Experiment A scores with Experiment B scores.** Different host, different vision input, same frozen protocol. In particular, do not put 36/45 next to 40/45 or 16/45 next to 19/45 as if they were one table.

Category reading for Experiment B only:

| Category | structured | vision |
| --- | --- | --- |
| Execution (15) | 15 | 2 |
| Gated grader (25) | 16 | 10 |
| Mechanism-true gated (25) | 10 | 0 |
| Vision-favorable (5) | 5 | 4 |

Mechanism-true gated here is hidden-slide body edit (5) plus `host_drift` sync/retry (5). Vision is 0 on that reading.

Primary writeup: [results/2026-09-15-impress-gemini-3.6-flash-n5-all-report.md](../results/2026-09-15-impress-gemini-3.6-flash-n5-all-report.md).  
Logs: [`.json`](../results/2026-09-15-impress-gemini-3.6-flash-n5-all.json), [`.md`](../results/2026-09-15-impress-gemini-3.6-flash-n5-all.md). JSONL provenance: §10.

## 6. Host drift recovery

This is the representative case: the IR does not own the document; the host can change out of band; the session must refuse, sync, retry, and **verify UNO state**.

Shared goal (prompt does not mention drift or sync):

> Change the title to "Recovered" and set its fill to #2f6f5f.

After `title_01` first becomes `"Recovered"`, the harness writes `"Out of band"` via `adapter.execute` (not the agent). The next apply is `host_diverged`. Structured `DONE` requires `hostDiverged > 0`, accepted `sync`, accepted title/fill retry after that sync, and a live snapshot with text `"Recovered"` and fill `#2f6f5f`.

### Structured — 5/5

All five structured repeats used the same five-step sequence. Example: `host_drift` structured `runIndex` 0 in the JSON log (`startedAt` `2026-09-15T11:36:03.936Z`, `model` `gemini-3.6-flash`, `driver` `live`, `adapter` `impress`).

| Step | Action | Result |
| --- | --- | --- |
| 0 | `set_text` `title_01` `"Recovered"` | `accepted` (text `Quarterly Review` → `Recovered`) |
| 1 | `set_fill` `title_01` `#2f6f5f` | `rejected`, `host_diverged` (“Host state changed outside this session. Call sync…”) |
| 2 | `sync` | `accepted` (acknowledges host text `Recovered` → `Out of band`) |
| 3 | `set_text` `title_01` `"Recovered"` | `accepted` (`Out of band` → `Recovered`) |
| 4 | `set_fill` `title_01` `#2f6f5f` | `accepted` |

Goal checks after that run (UNO snapshot, not the last tool payload alone):

| Check | ok | detail |
| --- | --- | --- |
| `title_recovered` | true | `Recovered` |
| `title_fill` | true | `#2f6f5f` |

Metrics: `verdict=DONE`, `usedSync=true`, `hostDiverged=1`, `usedRecovery=false` (this path is **sync**, not undo/snapshot restore).

| Repeat | verdict | steps | usedSync | hostDiverged | title check | fill check |
| --- | --- | --- | --- | --- | --- | --- |
| r0 | DONE | 5 | true | 1 | Recovered | #2f6f5f |
| r1 | DONE | 5 | true | 1 | Recovered | #2f6f5f |
| r2 | DONE | 5 | true | 1 | Recovered | #2f6f5f |
| r3 | DONE | 5 | true | 1 | Recovered | #2f6f5f |
| r4 | DONE | 5 | true | 1 | Recovered | #2f6f5f |

That is 5/5 **successful recovery after host drift** on a live Impress document: detect divergence, sync, retry, verify host state.

### Vision — 0/5

Vision has no `sync`. In this run it never produced title `"Recovered"`, so the harness inject never fired (`hostDiverged=0`). That is the gated miss for this observation channel, not a claim that screenshots recovered from host edits.

## 7. Vision limitations

Experiment B vision is **not** an Impress GUI benchmark.

- Clicks go through a **synthetic toolbar overlay** (`src/bench/compare/vision-frame.ts`), not LibreOffice chrome.
- Host page PNGs in the logs are about **96×54** pixels before that pad. `type` after `click` often returned `missing_target`.
- `contrast_check` is graded from the frozen **IR canvas raster**, not from the LibreOffice PNG. A host bitmap that disagreed with IR fill would not change the verdict.

Do not describe 16/45 as “the model used Impress.”

## 8. Other limitations

- **`recover_title` 5/5 vs 5/5 is a start-state pass.** The fixture title is already `"Quarterly Review"`. `usedRecovery` was false. Structured mostly `set_text` to the current title or took zero steps. This is not independent evidence of recovery skill. The recovery evidence is `host_drift` (§6).
- **`recolor_locked_logo` 0/5 vs 0/5 is policy.** `LOCKED_TARGET_POLICY=report_failed` cannot grade `DONE`. Structured still unlocked then filled (`#2f6f5f`). Zero is not “IR cannot see locks.”
- **Recovery covers only state the adapter exposes.** Impress snapshot restore rewrites that IR graph in the live document. It is not a binary `.odp` time machine.
- **Experiment A and Experiment B scores are not comparable** (different host and vision input).
- Common core was not extended for `impress__set_text`. `scir.transaction` with that wire name is `unknown_operation`; catalog `set_text` still applies.

## 9. Reproduction

LibreOffice must be installed. Set `SCIR_LIBREOFFICE` if it is not `C:\Program Files\LibreOffice\program`. This Windows npm does not forward `npm run compare -- --flags`; use `npx tsx` as below.

On this machine `.env` had `SCIR_COMPARE_PROVIDER=gemini` and `SCIR_COMPARE_MODEL=gemini-3.6-flash`. **Always set those in the shell for a live Impress run** so `settings.ts` does not fall through to `claude-sonnet-4-5`.

### Impress tests

```bash
npx vitest run tests/impress.test.ts
```

Skips cleanly if LibreOffice or `fixtures/impress/board.odp` is missing. Does not use the slides adapter.

### Scripted v4 on live Impress (not a model)

```bash
npx tsx examples/compare.ts --scripted --adapter=impress
```

Driver `scripted`, host real LibreOffice. If Impress is unavailable, process exits 2 (no slides fallback).

### Single-task live smoke

```powershell
$env:SCIR_COMPARE_PROVIDER="gemini"
$env:SCIR_COMPARE_MODEL="gemini-3.6-flash"
npx tsx examples/compare.ts --task=rename_title --repeats=1 --adapter=impress
```

This machine: structured `DONE` (`Board Update` from UNO), vision `FAILED` (title unchanged).

### Live 90-run (the recorded Experiment B)

```powershell
$env:SCIR_COMPARE_PROVIDER="gemini"
$env:SCIR_COMPARE_MODEL="gemini-3.6-flash"
npx tsx examples/compare.ts --repeats=5 --adapter=impress
```

Do not use `npm run compare:90` (that script is `--adapter=slides`). Do not omit the two env vars.

## 10. Artifact provenance

| File | How it was produced |
| --- | --- |
| `results/2026-09-15-impress-gemini-3.6-flash-n5-all.json` | Written by `examples/compare.ts` at process exit from the in-memory 90-run log. **Source of truth.** |
| `results/2026-09-15-impress-gemini-3.6-flash-n5-all.md` | Same exit path (category table). |
| `results/2026-09-15-impress-gemini-3.6-flash-n5-all-env.json` | Same exit path (host, LibreOffice version, model). |
| `results/2026-09-15-impress-gemini-3.6-flash-n5-all.jsonl` | **Not** appended per run during the process. Built afterwards by serializing the completed JSON (90 lines). Content matches the JSON array. |

The JSONL is a convenience copy of the completed JSON, not a contemporaneous flight recorder. Per-run append during the live loop is a follow-up for the next benchmark so a crash still leaves a partial log. Do not treat missing mid-run JSONL as evidence that the 90 JSON records are synthetic; those records were written by the live driver (`adapter=impress`, `driver=live`, `model=gemini-3.6-flash`).

## Second application: Blender

This is **not** a v4 90-run and not a comparison with Impress scores. It asks whether the same Adapter / Session / host-bridge pattern can change and independently verify state in a second real application.

```
TypeScript BlenderAdapter
    → bridge.py (bpy, 127.0.0.1)
    → blender.exe --background --factory-startup
    → scene snapshot
```

- **Adapter / bridge:** `src/adapters/blender.ts`, `src/adapters/blender/bridge.py`
- **IR operation:** domain `set_location` (metres). Not in the common core. Not a 2D Impress `move`.
- **Target:** seeded mesh `cube_01` (factory startup, then the adapter seed — not the stock object named `Cube`)
- **Action:** `set_location` to `(1, 2, 3)`
- **Verification:** a second `adapter.snapshot()` RPC after apply. `ActionResult.effects` is not the evidence.
- **Common IR core:** unchanged (`select`, `set_locked`, `delete` only)
- **v4 / scoring:** unchanged; no Blender task clone

### This machine (2026-09-15)

**Live Blender smoke passed** against a real `blender.exe`. This is not a v4 90-run.

| | |
|---|---|
| Host | `D:\SteamLibrary\steamapps\common\Blender\blender.exe` |
| Version | Blender 5.2.2 LTS (`d13f752e3b9c`, `blender-v5.2-release`) |
| Launch | `--background --factory-startup --python <temp>/bridge.py` (copy of `src/adapters/blender/bridge.py`) |
| Console | `LIVE_HOST=blender D:\SteamLibrary\steamapps\common\Blender\blender.exe` |
| Test | `tests/blender.test.ts` → `Blender live smoke` |
| Result | process started; seeded mesh `cube_01`; `set_location` `(1, 2, 3)`; **fresh `adapter.snapshot()`** reported `[1, 2, 3]`; process tree gone after `close()` |

The desktop GUI Blender that was already open was **not** the host. The adapter spawns its own background process and talks to that PID over `127.0.0.1`. It does not attach to, drive, or `taskkill` the interactive session.

`ActionResult.effects` was not treated as evidence. The checker read location from a second bpy snapshot after apply.

The rest of `tests/blender.test.ts` also passed on this host (13/13), including lock-before-mutate, host_drift, `.blend` round-trip, and v0 conformance. That is adapter coverage, not a compare-v4 score.

If `blender.exe` is missing, the same live-smoke test **skips**. It does not fall back to a mock or to the slides adapter. Console: `LIVE_HOST=skipped blender.exe not found (set SCIR_BLENDER)`.

```bash
# optional, if Blender is not on PATH / Steam / Program Files:
# SCIR_BLENDER=D:\SteamLibrary\steamapps\common\Blender\blender.exe
npx vitest run tests/blender.test.ts
```

## Follow-up (not done here)

- Append JSONL on each finished run inside the live loop.
- Do not unfreeze v4, change scoring, or add models to decorate a combined rate.
- Do not describe vision as Impress UI until chrome and export are real.

## Related files

- Adapter: `src/adapters/impress.ts`, `src/adapters/impress/bridge.py`
- Blender adapter / smoke: `src/adapters/blender.ts`, `src/adapters/blender/bridge.py`, `tests/blender.test.ts`
- Tests: `tests/impress.test.ts`, `tests/compare.test.ts` (live `.odp` subset)
- Protocol: `src/bench/compare/protocol.ts`, `src/bench/compare/tasks.ts` (v4, unmodified for this measurement)
- README pointer: section 5
