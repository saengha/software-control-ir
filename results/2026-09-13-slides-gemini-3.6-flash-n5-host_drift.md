# Compare slides

- protocol: scir-compare-v0 v4
- driver: live
- model: gemini-3.6-flash
- adapter: slides
- repeats: 5
- tasks: host_drift
- when: 2026-09-13T15:19:18.027Z

```
--- execution ---
success  structured —  vision —
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
(no tasks)

--- gated ---
success  structured 5/5  vision 0/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
host_drift             5/5      0.00   0/5      0.00   6.80±0.45  8.00±0.00

--- vision-favorable ---
success  structured —  vision —
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
(no tasks)

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
host_drift             5/5          0/5
success  structured 5/5  vision 0/5
```
