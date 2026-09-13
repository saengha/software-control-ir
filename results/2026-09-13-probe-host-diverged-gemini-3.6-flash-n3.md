# host_diverged structured probe

Not a win-rate run. Same host_drift prompt, tools, fixture, and model.
After the usual inject/Continue path, one function-call-required turn is used
only if the model never applied after inject, so a real host_diverged tool_result
can sit in Gemini context. No recovery instruction is added to the prompt.

- model: gemini-3.6-flash
- repeats: 3
- when: 2026-09-13T15:00:01.542Z

```
run 0  model=gemini-3.6-flash  delivery=forced_any
  inGemini=true  modelSawInRequest=true  textUnderstands=false  sync=true  retryAfterSync=true  recovered=true  title="Recovered"
  t0 [auto] reqDiverged=false  slides.set_text({"value":"Recovered","target":"title_01","expectedRevision":0}) → accepted
  t1 [auto] reqDiverged=false  text="DONE"
  t2 [auto] reqDiverged=false  text="DONE"
  t3 [auto] reqDiverged=false  text="DONE"
  t4 [any] reqDiverged=false  scir.state({"scope":"relevant"}) → accepted
  t5 [auto] reqDiverged=false  slides.set_text({"target":"title_01","value":"Recovered","expectedRevision":1}) → host_diverged
  t6 [auto] reqDiverged=true  scir.sync({}) → accepted
  t7 [auto] reqDiverged=true  slides.set_text({"value":"Recovered","target":"title_01","expectedRevision":2}) → accepted
  t8 [auto] reqDiverged=true  text="DONE"

run 1  model=gemini-3.6-flash  delivery=forced_any
  inGemini=true  modelSawInRequest=true  textUnderstands=false  sync=true  retryAfterSync=true  recovered=true  title="Recovered"
  t0 [auto] reqDiverged=false  slides.set_text({"expectedRevision":0,"target":"title_01","value":"Recovered"}) → accepted
  t1 [auto] reqDiverged=false  text="DONE"
  t2 [auto] reqDiverged=false  text="DONE"
  t3 [auto] reqDiverged=false  text="DONE"
  t4 [any] reqDiverged=false  scir.state({"scope":"relevant"}) → accepted
  t5 [auto] reqDiverged=false  slides.set_text({"target":"title_01","expectedRevision":1,"value":"Recovered"}) → host_diverged
  t6 [auto] reqDiverged=true  scir.sync({}) → accepted
  t7 [auto] reqDiverged=true  slides.set_text({"value":"Recovered","target":"title_01","expectedRevision":2}) → accepted
  t8 [auto] reqDiverged=true  text="DONE"

run 2  model=gemini-3.6-flash  delivery=forced_any
  inGemini=true  modelSawInRequest=true  textUnderstands=false  sync=true  retryAfterSync=true  recovered=true  title="Recovered"
  t0 [auto] reqDiverged=false  slides.set_text({"expectedRevision":0,"target":"title_01","value":"Recovered"}) → accepted
  t1 [auto] reqDiverged=false  text="DONE"
  t2 [auto] reqDiverged=false  text="DONE"
  t3 [auto] reqDiverged=false  text="DONE"
  t4 [any] reqDiverged=false  scir.state({}) → accepted
  t5 [auto] reqDiverged=false  slides.set_text({"expectedRevision":1,"value":"Recovered","target":"title_01"}) → host_diverged
  t6 [auto] reqDiverged=true  scir.sync({}) → accepted
  t7 [auto] reqDiverged=true  slides.set_text({"value":"Recovered","target":"title_01","expectedRevision":2}) → accepted
  t8 [auto] reqDiverged=true  text="DONE"

```
