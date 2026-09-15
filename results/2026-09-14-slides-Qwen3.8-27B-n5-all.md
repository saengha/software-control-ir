# Compare slides

- protocol: scir-compare-v0 v4
- driver: live
- model: Qwen3.8-27B
- adapter: slides
- repeats: 5
- tasks: all
- when: 2026-09-15T00:56:14.768Z

```
--- execution ---
success  structured 15/15  vision 11/15
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
rename_title           5/5      0.00   3/5      0.55   1.40±0.55  8.00±0.00  spread
recolor_accent         5/5      0.00   3/5      0.55   2.00±1.22  6.80±1.64  spread
add_callout            5/5      0.00   5/5      0.00   1.00±0.00  6.00±1.87

--- gated ---
success  structured 15/25  vision 6/25
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
recolor_locked_logo    0/5      0.00   0/5      0.00   3.20±1.10  8.00±0.00
edit_hidden_slide      5/5      0.00   0/5      0.00   5.20±2.17  8.00±0.00
recover_title          5/5      0.00   5/5      0.00   2.20±1.64  8.00±0.00
abort_rebrand          0/5      0.00   1/5      0.45   5.60±1.67  8.00±0.00  spread
host_drift             5/5      0.00   0/5      0.00   5.20±0.45  8.00±0.00

--- vision-favorable ---
success  structured 5/5  vision 2/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
contrast_check         5/5      0.00   2/5      0.55   1.00±0.00  7.20±1.79  spread

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
rename_title           5/5          3/5  spread
recolor_accent         5/5          3/5  spread
recolor_locked_logo    0/5          0/5
add_callout            5/5          5/5
edit_hidden_slide      5/5          0/5
recover_title          5/5          5/5
abort_rebrand          0/5          1/5  spread
host_drift             5/5          0/5
contrast_check         5/5          2/5  spread
success  structured 35/45  vision 19/45
```
