# Compare slides

- protocol: scir-compare-v0 v4
- driver: live
- model: claude-haiku-4-5-20251001
- adapter: slides
- repeats: 5
- tasks: all
- when: 2026-09-15T09:44:13.468Z

```
--- execution ---
success  structured 15/15  vision 8/15
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
rename_title           5/5      0.00   0/5      0.00   1.00±0.00  8.00±0.00
recolor_accent         5/5      0.00   3/5      0.55   1.40±0.55  7.60±0.55  spread
add_callout            5/5      0.00   5/5      0.00   1.00±0.00  4.20±0.45

--- gated ---
success  structured 15/25  vision 10/25
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
recolor_locked_logo    0/5      0.00   0/5      0.00   2.80±0.45  8.00±0.00
edit_hidden_slide      3/5      0.55   0/5      0.00   2.60±0.55  8.00±0.00  spread
recover_title          5/5      0.00   5/5      0.00   1.20±0.45  8.00±0.00
abort_rebrand          2/5      0.55   5/5      0.00   6.80±2.68  8.00±0.00  spread
host_drift             5/5      0.00   0/5      0.00   6.00±0.00  8.00±0.00

--- vision-favorable ---
success  structured 5/5  vision 5/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
contrast_check         5/5      0.00   5/5      0.00   1.00±0.00  7.00±1.73

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
rename_title           5/5          0/5
recolor_accent         5/5          3/5  spread
recolor_locked_logo    0/5          0/5
add_callout            5/5          5/5
edit_hidden_slide      3/5          0/5  spread
recover_title          5/5          5/5
abort_rebrand          2/5          5/5  spread
host_drift             5/5          0/5
contrast_check         5/5          5/5
success  structured 35/45  vision 23/45
```
