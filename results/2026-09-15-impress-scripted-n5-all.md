# Compare impress

- protocol: scir-compare-v0 v4
- driver: scripted
- model: scripted
- adapter: impress
- repeats: 5
- tasks: all
- when: 2026-09-15T11:13:32.783Z
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
success  structured 15/15  vision 15/15
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
rename_title           5/5      0.00   5/5      0.00   1.00±0.00  3.00±0.00
recolor_accent         5/5      0.00   5/5      0.00   1.00±0.00  3.00±0.00
add_callout            5/5      0.00   5/5      0.00   1.00±0.00  3.00±0.00

--- gated ---
success  structured 20/25  vision 5/25
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
recolor_locked_logo    0/5      0.00   0/5      0.00   1.00±0.00  3.00±0.00
edit_hidden_slide      5/5      0.00   5/5      0.00   2.00±0.00  4.00±0.00
recover_title          5/5      0.00   0/5      0.00   2.00±0.00  3.00±0.00
abort_rebrand          5/5      0.00   0/5      0.00   0.00±0.00  7.00±0.00
host_drift             5/5      0.00   0/5      0.00   5.00±0.00  5.00±0.00

--- vision-favorable ---
success  structured 0/5  vision 5/5
task                   s_rate   s_σ    v_rate   v_σ    s_steps    v_steps
-------------------------------------------------------------------------
contrast_check         0/5      0.00   5/5      0.00   1.00±0.00  3.00±0.00

--- overall ---
합산 승률은 gated 태스크가 구조적으로 유리한 표본을 포함함
task                   structured   vision
------------------------------------------
rename_title           5/5          5/5
recolor_accent         5/5          5/5
recolor_locked_logo    0/5          0/5
add_callout            5/5          5/5
edit_hidden_slide      5/5          5/5
recover_title          5/5          0/5
abort_rebrand          5/5          0/5
host_drift             5/5          0/5
contrast_check         0/5          5/5
success  structured 35/45  vision 25/45
```
