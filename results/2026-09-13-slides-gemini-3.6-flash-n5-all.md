# Compare slides

- protocol: scir-compare-v0 v4
- driver: live
- model: gemini-3.6-flash
- adapter: slides
- repeats: 5
- tasks: all
- when: 2026-09-13T15:41:13.761Z

```
--- execution ---
success  structured 15/15  vision 6/15
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
rename_title           5/5      0.00   5/5      0.00   1.00±0.00  5.00±0.00
recolor_accent         5/5      0.00   0/5      0.00   1.00±0.00  3.20±2.68
add_callout            5/5      0.00   1/5      0.45   1.00±0.00  4.40±1.95  spread

--- gated ---
success  structured 20/25  vision 8/25
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
recolor_locked_logo    0/5      0.00   0/5      0.00   2.00±0.00  7.60±0.55
edit_hidden_slide      5/5      0.00   0/5      0.00   3.80±0.45  8.00±0.00
recover_title          5/5      0.00   5/5      0.00   1.00±0.00  5.40±0.89
abort_rebrand          5/5      0.00   3/5      0.55   4.00±1.87  6.40±2.61  spread
host_drift             5/5      0.00   0/5      0.00   7.00±0.00  8.00±0.00

--- vision-favorable ---
success  structured 5/5  vision 5/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
contrast_check         5/5      0.00   5/5      0.00   1.00±0.00  4.00±0.00

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
rename_title           5/5          5/5
recolor_accent         5/5          0/5
recolor_locked_logo    0/5          0/5
add_callout            5/5          1/5  spread
edit_hidden_slide      5/5          0/5
recover_title          5/5          5/5
abort_rebrand          5/5          3/5  spread
host_drift             5/5          0/5
contrast_check         5/5          5/5
success  structured 40/45  vision 19/45
```
