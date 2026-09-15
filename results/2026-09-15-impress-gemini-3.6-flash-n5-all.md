# Compare impress

- protocol: scir-compare-v0 v4
- driver: live
- model: gemini-3.6-flash
- adapter: impress
- repeats: 5
- tasks: all
- when: 2026-09-15T11:42:00.201Z
- host: real LibreOffice Impress process (UNO)
- os: win32 10.0.26100
- git: 318e1743e135723f9be9ebff83a2973719685ac8
- libreoffice: LibreOffice 26.8.0.3 bce0998afefdbc355585ca324285661a2170ba77
- fixture: C:\Users\JHH\software control IR\fixtures\impress\board.odp
- contrastFixture: C:\Users\JHH\software control IR\fixtures\impress\contrast.odp
- documentState: UNO snapshot of the live .odp
- visionChrome: synthetic toolbar overlay (not the Impress UI)
- contrastGrader: frozen v4 IR canvas raster (host PNG is not the verdict)

```
--- execution ---
success  structured 15/15  vision 2/15
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
rename_title           5/5      0.00   0/5      0.00   1.00±0.00  4.40±3.29
recolor_accent         5/5      0.00   1/5      0.45   1.00±0.00  7.00±1.73  spread
add_callout            5/5      0.00   1/5      0.45   1.00±0.00  7.20±1.30  spread

--- gated ---
success  structured 16/25  vision 10/25
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
recolor_locked_logo    0/5      0.00   0/5      0.00   2.00±0.00  7.80±0.45
edit_hidden_slide      5/5      0.00   0/5      0.00   3.80±0.45  8.00±0.00
recover_title          5/5      0.00   5/5      0.00   0.80±0.45  6.60±2.19
abort_rebrand          1/5      0.45   5/5      0.00   5.40±2.07  6.00±1.58  spread
host_drift             5/5      0.00   0/5      0.00   5.00±0.00  6.40±2.61

--- vision-favorable ---
success  structured 5/5  vision 4/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
contrast_check         5/5      0.00   4/5      0.45   1.00±0.00  3.60±0.89  spread

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
rename_title           5/5          0/5
recolor_accent         5/5          1/5  spread
recolor_locked_logo    0/5          0/5
add_callout            5/5          1/5  spread
edit_hidden_slide      5/5          0/5
recover_title          5/5          5/5
abort_rebrand          1/5          5/5  spread
host_drift             5/5          0/5
contrast_check         5/5          4/5  spread
success  structured 36/45  vision 16/45
```
