# Compare slides

- protocol: `scir-compare-v0` v3
- driver: live
- model: `gemini-3.6-flash` (same model for structured and vision)
- adapter: slides
- repeats: 5
- tasks: `contrast_check`, `host_drift`
- when: 2026-09-13T13:54:49.148Z
- duration: ~2.5 min
- thinking: `thinkingLevel=minimal`
- raw logs: `2026-09-13-slides-gemini-3.6-flash-n5-contrast_check+host_drift.json`

`gemini-2.5-flash` is closed to new API keys. Google returned 404 and pointed at `gemini-3.6-flash`.

```
--- gated ---
success  structured 5/5  vision 0/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
host_drift             5/5      0.00   0/5      0.00   1.00±0.00  8.00±0.00

--- vision-favorable ---
success  structured 5/5  vision 5/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
contrast_check         5/5      0.00   5/5      0.00   1.00±0.00  4.00±0.00

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
host_drift             5/5          0/5
contrast_check         5/5          5/5
success  structured 10/10  vision 5/10
```

## How to read this

This is a 20-run live pilot, not the 90-run. Category tables matter; the 10/10 vs 5/10 line does not.

### contrast_check

Both policies passed 5/5. The frozen scripted structured fill (`#7eb8f0`) fails WCAG AA; a live model does not have to pick that fill. Structured `set_fill` choices were dark blues (`#0b2545`, `#1e3a8a`, `#102a43`, `#1a365d`) at 10.36:1–15.39:1. Vision used the same kind of dark blue via right-click + type, in 4 steps.

The scripted “structured fails / vision succeeds” split did **not** reproduce with `gemini-3.6-flash`. That split was an artifact of the frozen fill, not of the IR vs pixels.

### host_drift

Structured 5/5 in **one** `set_text` and never called `sync`. `hostDiverged` was 0. Inject is after 3 tool calls; the live model finished the goal before the harness mutated `title_01`. So this 5/5 is **not** a measurement of recovery from host drift. It is a measurement that a structured agent can rename a title in one call.

Vision 0/5. After the inject, the title is `"Out of band"`. Later clicks/types hit `host_diverged` (2–4 times per run). Vision has no `sync` tool and burned the 8-step budget. Final text stayed `"Out of band"`. That half of the gate behaved as designed.

If the next 90-run wants structured to actually meet `host_diverged`, inject has to happen before the first apply (or the goal has to take more than 3 steps). Do not treat this pilot’s structured `host_drift` rate as that test.

## Budget note

5786 KRW (~$4) was enough for this 20-run slides pilot on `gemini-3.6-flash` with thinking set to minimal. Do not start the full 90-run until `host_drift` inject timing is decided.
