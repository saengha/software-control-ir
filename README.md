# Software Control IR

Software already knows what it is. AI shouldn't have to figure it out from a screenshot.

An experimental project exploring a semantic intermediate representation (IR) for AI-controlled software.

The idea is simple:

> Can we give AI agents a structured representation of software state and operations, instead of making them reconstruct everything from pixels or application-specific code?

This project is an attempt to find out.

## Why?

AI agents can already interact with software in several ways:

```
Screenshot → Vision → Mouse / Keyboard
```

or:

```
LLM → Code → Application API
```

Both approaches are useful, but they share a common cost:

The model often has to perform high-level inference to reconstruct state, understand what changed, and decide how an operation should be expressed — even when the underlying operation itself is mechanically simple.

For example, a screenshot may contain everything an agent needs to identify an object, but the model still has to infer:

- What objects exist
- Which object is the target
- Its exact properties
- Whether it is locked or editable
- What changed after an operation
- Whether the operation actually succeeded

Likewise, when using an application API, the model may need to reason through application-specific APIs and code before it can perform a relatively simple operation.

That inference has a cost.

Every screenshot interpreted, every API behavior reasoned about, and every verification step consumes computation and introduces another opportunity for error.

The cost can therefore depend not only on what the software is doing, but also on how much the model has to figure out before it can do it.

## A different approach

A structured IR could shift some of that work from inference to explicit representation.

Instead of asking the model to reconstruct the current state and improvise an operation:

```
Screenshot
    ↓
Vision
    ↓
Inference
    ↓
Mouse / Keyboard
```

the application could expose structured state:

```
Application
    ↓
Structured State
    ↓
Software Control IR
    ↓
AI Agent
    ↓
Structured Action
    ↓
Application
```

For example:

```json
{
  "action": "set_temperature",
  "target": "heater_01",
  "value": 150
}
```

The model is not asked to discover what `heater_01` is from pixels. It is given a structured state and asked to select a precise operation against that state.

This plays to a useful property of language models:

Selecting and composing well-defined operations can be simpler than reconstructing the meaning of an application from incomplete observations.

If this works, two things may follow:

1. **Less inference.** The model may spend less effort reasoning about what the current state actually is. This could potentially reduce token usage, invalid actions, unnecessary tool calls, state-related errors, and execution latency.
2. **More observable actions.** If operations are represented as discrete structured actions, each step can potentially be inspected, validated, recorded, and reversed.

Instead of treating an automation session as one opaque sequence:

```
Run everything
     ↓
Something went wrong
     ↓
Undo / Start over
```

the system could represent changes as revisions:

```
Revision 41
    ↓
Action A
    ↓
Revision 42
    ↓
Action B
    ↓
Revision 43
```

This could make individual operations easier to inspect or recover from.

Whether these advantages actually exist — and how large they are — is something this project needs to measure rather than assume.

## The core idea

The project explores a small set of concepts for representing software control:

```
State
  ↓
Action
  ↓
Precondition
  ↓
Validation
  ↓
Effect
  ↓
Revision
  ↓
Rollback
```

These concepts are intentionally simple at this stage.

The goal is not to define every possible operation that software might support. Instead, the project is exploring whether a small semantic layer can make certain AI-driven operations easier to understand, validate, and recover from.

## What is an IR?

IR stands for Intermediate Representation.

Compilers provide a useful analogy:

```
High-level language
        ↓
       IR
        ↓
Machine code
```

This project explores a similar idea for software control:

```
AI Agent
    ↓
Software Control IR
    ↓
Application Adapter
    ↓
Existing Software
```

The IR is not intended to replace an application's existing API. Instead, an adapter can translate between the application's native model and the semantic representation exposed to the AI.

## State

The first part of the model is State.

An application may already know information such as object IDs, positions, dimensions, values, selection state, lock state, relationships, and current configuration.

Instead of asking an AI to infer these from pixels, an adapter could expose the relevant information directly.

```json
{
  "id": "heater_01",
  "type": "heater",
  "position": [120, 80],
  "temperature": 120,
  "locked": false
}
```

The important word here is **relevant**.

The goal is not necessarily to expose the entire application state. A useful adapter may instead provide the minimum state needed for the current task.

## Actions

An Action describes what the AI wants to change.

```json
{
  "action": "set_temperature",
  "target": "heater_01",
  "value": 150
}
```

The adapter can translate this into whatever native operation the application actually uses.

The AI-facing representation does not need to know whether the application internally uses Python, JavaScript, C++, a document format, a plugin API, an RPC interface, or something else. That complexity can remain inside the adapter.

## Validation

An action can potentially be checked before it modifies the application.

```
Target exists?
       ↓
Operation supported?
       ↓
Value valid?
       ↓
Preconditions satisfied?
       ↓
Execute
```

An invalid action could therefore be rejected before it changes the application. This is one of the main ideas the project wants to investigate.

## Effects and results

After an action is executed, the application should ideally provide structured information about the result.

```
Before
  temperature = 120

Action
  set_temperature(150)

After
  temperature = 150
```

This creates a clearer relationship between `State → Action → Resulting State` rather than requiring the AI to determine the result indirectly from another screenshot or by guessing what an API call did.

## Revisions and rollback

Changes can also be represented as revisions.

```
Revision 41
    ↓
Set temperature to 150
    ↓
Revision 42
    ↓
Move object
    ↓
Revision 43
```

If the underlying application supports it, an adapter could provide a way to restore an earlier revision.

This does not assume that every application has perfect undo support. Rollback may need to be implemented differently depending on the application.

Two mechanisms are implemented, and a result says which one was used:

```
compensation
    → apply an inverse action, history moves forward
      set_text("Board Update")  →  set_text("Quarterly Review")

snapshot
    → restore a recorded state, history moves back
      used when the adapter can overwrite the host document
```

Compensation is the one that could survive contact with real software, where the IR does not own the document and cannot simply overwrite it. Snapshot restore is advertised only when the adapter says it can. An in-memory adapter can offer both. A host-owned wrapper around the same lab scene refuses rollback, undoes with inverse actions, and says `dirty_state` when a batch prefix cannot be inverted.

A host can also change out of band. The session then rejects further actions with `host_diverged` until `sync` acknowledges the new state. An action may include `expectedRevision` so a stale agent is rejected instead of overwriting a newer document.

A batch either lands completely or leaves no changes behind:

```
move      accepted
set_locked accepted
set_fill  rejected  (invalid color)
    ↓
revision unchanged, both accepted actions reverted
```

Later actions can depend on earlier effects, so a batch is validated one action at a time and an already-applied prefix is reverted rather than prevented.

The goal is simply to explore whether explicit revisions can make AI-driven changes easier to inspect and recover from.

## Adapters

An adapter connects the semantic IR to an existing application.

```
Software Control IR
        ↓
      Adapter
        ↓
Existing Application
```

The adapter has an important job:

```
Native Application State
        ↓
Semantic Mapping
        ↓
Software Control IR
        ↓
Validation
        ↓
Native Operation
```

This is likely to be one of the hardest parts of the project.

Different applications often represent similar concepts in completely different ways. For example, resize might mean changing an object's scale in Blender, changing a bounding box in PowerPoint, or modifying a parametric constraint in CAD.

Because of this, the project does not assume that every application should use exactly the same commands.

The current direction is:

```
Small Common Core
        +
Domain-Specific Extensions
```

rather than trying to force every application into one universal vocabulary.

## Accessibility trees

Accessibility APIs already provide a structured representation of many user-interface elements.

```
Window
 ├── Button "Save"
 ├── TextBox "Name"
 └── CheckBox "Enabled"
```

This is valuable and can potentially be one source of information for an adapter.

A rough distinction explored by this project is:

```
Vision
    → What is visible?

Accessibility Tree
    → What can the user interact with?

Software Control IR
    → What meaningful state and operations does the software expose?
```

These approaches are complementary. An adapter could potentially use accessibility information together with native application state, document data, or application APIs.

## How is this different from MCP?

MCP is useful for connecting AI systems with tools and resources. This project is exploring a different layer.

A possible architecture is:

```
AI Agent
    ↓
MCP
    ↓
Software Control IR
    ↓
Adapter
    ↓
Application
```

MCP can provide the mechanism through which an AI discovers and calls tools. The IR is concerned with how the software's semantic state, actions, validation, and results are represented.

The project does not attempt to replace MCP. MCP could be one way to expose or transport the IR.

To check that this is actually true rather than assumed, an adapter catalog can be projected as typed tool descriptors:

```
slides.create_shape   required: kind, x, y, width, height
slides.group          required: ids
scir.sync             required: -
scir.transaction      required: actions
scir.undo             required: -
```

The projection is mechanical, so the IR stays the single source of validation and state. Tool results are deliberately compact: an agent that already holds the state does not need two more copies of it returned to it.

## How is this different from OpenAPI or JSON-RPC?

OpenAPI and JSON-RPC are useful for describing and calling APIs. This project is interested in questions that can exist above that level:

- What state does this operation act on?
- What must be true before it runs?
- What changes after it runs?
- What was the resulting state?
- Can the change be represented as a revision?
- Can the operation be reversed?

An adapter could still use OpenAPI, JSON-RPC, or an application's native API underneath. The IR is not intended to replace those technologies.

## Native code agents

Another important alternative is direct code execution. An AI agent can often write something like `application.do_something(...)`.

This approach is extremely powerful. It provides a level of flexibility that a constrained IR may not.

Software Control IR is therefore not intended to replace code agents. The hypothesis is narrower:

A constrained semantic interface may make some operations easier to validate, inspect, and recover from.

A code agent can potentially do almost anything the application allows. An IR may intentionally do less, in exchange for a more predictable operation surface.

Whether that trade-off is useful is something the project needs to test.

## Related work

This project is not starting from zero. There are already related ideas and projects in several nearby areas.

- **Tarsier** — open-source project from Reworkd focused on helping agents understand and interact with webpages using structured representations such as tagged interactable elements and OCR-derived information. It is primarily focused on web perception and interaction, rather than a general semantic state/action model for arbitrary software.
- **Manifesto** — explores explicit application state, typed actions, and deterministic state transitions. These ideas are closely related to the state/action model being explored here.
- **car-ir** — explores an intermediate representation for agent actions, including concepts such as preconditions, effects, idempotency, and failure behavior. This is particularly relevant to the validation and execution side of this project.

These projects are useful references rather than things this project is trying to replace. The underlying ideas are not claimed as new.

The question being explored here is:

> Can these ideas be brought together into a practical software-facing layer focused on state, semantic actions, validation, revisions, and recovery?

That is an engineering question that needs to be answered through implementation.

## Conformance

If multiple adapters are eventually created, it may be useful to have shared tests.

```
Software Control IR
        ↓
  Conformance Tests
    / | \
Blender App B App C
```

The shared checks currently ask whether an adapter:

1. Resolves the requested target correctly
2. Rejects an invalid action without mutating anything
3. Performs the operation
4. Reports the resulting state and effects
5. Creates a revision when supported
6. Restores the previous state when supported
7. Describes its own capabilities and object types
8. Leaves no changes behind when a batch aborts
9. Undoes the newest revision and says which mechanism it used

Lab, slides, and Impress (when LibreOffice is installed) pass the same checks. They do not pass them the same way: slides can fall back to a snapshot restore where lab can compensate with an inverse action, and Impress can do both — compensation for undo, IR-to-UNO rewrite for rollback. That difference is the point of running the same checks against each adapter.

This is currently a proposed direction, not an established specification.

## The main question

The project is ultimately trying to answer one question:

> Can a small semantic layer make AI-controlled software more predictable, inspectable, and recoverable than relying only on screenshots or unrestricted application-specific code?

I don't know the answer yet. That's the reason for building this project.

## First experiment

The first measurement is not “many applications.” It is one fixed protocol against a software-shaped adapter and, when LibreOffice is installed, against a live `.odp`.

The protocol is `scir-compare-v0` (prompt set **v3**, experiment log `schema/experiment.v2.json`). Both agents get the same natural-language goal and the same step budget. When the driver is `live`, they also get the **same model** (`SCIR_COMPARE_MODEL`, default in `.env` is `gemini-3.6-flash`). They do not get the same tools:

```
Screenshots + click / type / scroll / right_click
        vs.
Structured catalog (as-is) + undo + sync
```

Each structured call returns the resulting state and any validation error. The vision agent has no object IDs, lock flags, or hidden-slide flags — only the rendered image and what a visible UI panel would show. Both say `DONE` or `FAILED`.

There are two drivers:

- **`scripted`** — frozen action lists. Deterministic baseline. No API key.
- **`live`** — real tool loop, PNG screenshots for vision. Gemini (`GEMINI_API_KEY`) or Anthropic (`ANTHROPIC_API_KEY`). Copy `.env.example` to `.env`.

Nine goals, in three categories (see `docs/tasks.md`):

| Category | Tasks | What it is for |
| --- | --- | --- |
| **execution** | `rename_title`, `recolor_accent`, `add_callout` | Visible edits a screenshot agent can attempt |
| **gated** | `recolor_locked_logo`, `edit_hidden_slide`, `recover_title`, `abort_rebrand`, `host_drift` | Lock, hidden slide, recovery, atomic batch, host interference — structured has a channel vision does not |
| **vision-favorable** | `contrast_check` | Graded from the rendered raster, not from IR `set_fill` success |

Do not treat the overall win rate as the result. Gated tasks are structurally easier for the structured policy. The report prints that warning next to the combined table.

`host_drift` is not a mock flag. After `HOST_DRIFT_AFTER_STEPS` (default 3) tool calls, the harness mutates **`title_01` text** to `"Out of band"` behind the session. The goal is only `Set the title to "Recovered".` Structured must `sync` before it can finish the edit. Vision has no `sync` tool.

`contrast_check` uses a separate fixture (`fixtures/impress/contrast.odp` / slides `contrast` preset): white text on a light background. The structured script’s fill can succeed in IR and still fail the raster grader (WCAG AA 4.5:1). That is the point of the task.

## Progress

**Last updated: 2026-09-13.** Experimental / early stage. Not a standard.

This is a working log of what exists, what has been measured, what was found and fixed, and what is still unrun. The question in “The main question” has not been answered yet. These notes are so the next run does not re-learn the same protocol bugs at 90-run cost.

### Runtime and IR

Implemented and tested:

- Minimal IR: state, action, validation, effect, revision, rollback.
- `Session`: validate before mutate; effects and revision on every accepted action; `expectedRevision` / `stale_revision`.
- Common core stays small: `select`, `set_locked`, `delete`. Domain ops live on adapters.
- Atomic batches: an abort reverts the accepted prefix, or the adapter says `dirty_state` instead of claiming atomicity.
- Recovery names its mechanism: `compensation` (inverse action, revision moves forward) vs `snapshot` (restore recorded state). Snapshot restore is advertised only when the adapter can overwrite the host document.
- Host-owned documents: out-of-band change → `host_diverged` → further actions refused until explicit `sync`. `hostOwned()` wraps an in-memory adapter so snapshot restore is not a fake product promise.
- Relevant-state slices (current slide, not the whole deck). On a 48-object deck the relevant slice is 6 objects and about 13% of the tokens of the full document. That measures the representation, not an agent.
- Catalog projected as typed tool descriptors + dispatcher. Compact tool results: an agent that already holds state does not get two more copies of it.
- Published schema tested against real session output (`schema/scir.v0.json`).
- Shared conformance suite: lab, slides, and Impress (when LibreOffice is installed) pass the same checks by different mechanisms.

### Adapters

| Adapter | What it is | Recovery | Notes |
| --- | --- | --- | --- |
| **lab** | `heater` / `vessel` stand-in | compensation, optional snapshot | Original fixture |
| **slides** | In-memory PPT-like surface | compensation + snapshot | Not Microsoft PowerPoint. `resize` is a bounding box. Grouping is a domain op the common core should never learn |
| **impress** | Live LibreOffice Impress over UNO | compensation for undo; snapshot restore by rewriting the live document from IR state | First contact with real software |

Impress loads `fixtures/impress/board.odp` (and `contrast.odp` for `contrast_check`). Headless `soffice.com` gets a private `UserInstallation` and `--nolockcheck` so it does not become the desktop LibreOffice singleton (the failure mode that shows up as a bogus `bootstrap.ini` error). `close()` kills only that process tree. Coordinates are millimetres. Out-of-band UNO edits surface as `host_diverged` until `sync`. Direct `soffice.bin` is not the entry point — it exits without opening `--accept`. Set `SCIR_LIBREOFFICE` if LibreOffice is not in `C:\Program Files\LibreOffice\program`.

### Compare harness

Code lives in `src/bench/compare/`. CLI: `examples/compare.ts`.

- Prompt set v3. Frozen prompt **text** is unchanged from v2; the version bump is for the live driver, repeats, and log fields.
- Experiment log: `schema/experiment.v2.json` (required `taskCategory`, `driver`, `runIndex`; optional `model`, `hostDriftAfterSteps`). v0/v1 are deprecated; `npm run migrate:experiment` rewrites old logs.
- Default repeats **N=5**. Report prints `5/5`-style rates, sample standard deviation (`s_σ` / `v_σ`), category subtables, and a `spread` mark when repeats disagree.
- Live path: Gemini (`GEMINI_API_KEY`, default `gemini-3.6-flash`) or Anthropic. Structured uses `toolDescriptors()` / `createDispatcher()`. Vision uses a PNG screenshot and maps clicks through `src/bench/compare/ui.ts`. Thinking is set to minimal on Gemini 3 so output tokens stay cheap.
- Replay client (`createReplayClient`) drives the **same** live loop with frozen scripts so the loop is tested without spending API budget.
- `--dry-run` forces N=1. `--scripted` uses frozen scripts. `--adapter=slides|impress|all`. `--category=`. `--task=id,id` for a subset (used by the pilot).
- This Windows npm does **not** forward `npm run compare -- --scripted`. Use `npm run compare:scripted`, `npm run compare:dry`, `npm run compare:pilot`, or `npx tsx examples/compare.ts ...`.

### Protocol bugs found before burning a 90-run

These are cheap to miss in a scripted dry-run and expensive to discover after 90 live calls.

**1. Vision click hit-test was leaking IR fields. Fixed.**

`click(x,y)` → hit-test → UNO/IR is the right shape (a real mouse click also lands on coordinates and the app decides what was hit). The leak was in the **tool result text** sent back to the vision model: `CompactResult` went out with `effects[].target` (`logo_01`), `focus.properties.locked`, `issues[].code === "locked"`, and the right-click panel included `"locked": true`. That breaks the vision prompt’s “no lock state / no object IDs” premise and would contaminate gated tasks, especially `recolor_locked_logo`.

Now the vision model only gets screenshot pixels plus visible chrome: toolbar, slide tabs, optional panel `{ fill, text }`, optional toast. The driver still knows lock state internally; experiment logs still store `step.result` for the experimenter. Tests assert that live vision `tool_result` JSON does not contain `"locked":`, seed object ids, `effects`, or `issues`. A locked edit toast is `This object cannot be edited.` — it does not name the IR field.

**2. `host_drift` mutates the title, not some other field. Confirmed.**

The inject is `set_text` on `title_01` to `"Out of band"`. That is the same field the goal edits. Structured will hit `host_diverged` on the next apply unless it `sync`s — **if it is still running when the inject fires**.

**3. Live structured can finish `host_drift` before the inject. Seen in the pilot.**

`HOST_DRIFT_AFTER_STEPS` is 3. `gemini-3.6-flash` renamed the title in one `set_text` (5/5, `usedSync=false`, `hostDiverged=0`). The 5/5 is not a recovery measurement. Vision did hit drift and went 0/5, title stuck on `"Out of band"`. Fix inject timing before a 90-run if structured is supposed to meet `host_diverged`.

### What has been measured

| Run | Adapter | Driver | Result |
| --- | --- | --- | --- |
| Scripted 9 tasks × 2 policies × 5 repeats (90) | slides | frozen scripts | Deterministic rates (5/5 where the script is supposed to succeed). Confirms the grader and logs, **not** a model. |
| Live loop, all 9 × 2, replay client | slides | live loop, no API | Tests pass. The loop, PNG codec, click mapping, inject timing, and tool wiring are exercised. |
| Impress conformance + compare (scripted) | live `.odp` | tests | LibreOffice path works when installed: private profile, UNO mutate, host drift, snapshot rewrite. |
| Live model, `contrast_check` + `host_drift`, N=5 (pilot) | slides | `gemini-3.6-flash` | **Done.** [results/2026-09-13-slides-gemini-3.6-flash-n5-contrast_check+host_drift.md](results/2026-09-13-slides-gemini-3.6-flash-n5-contrast_check+host_drift.md). `contrast_check` 5/5 vs 5/5 (scripted split did not reproduce). `host_drift` 5/5 vs 0/5, but structured never saw drift. |
| Live model, full 9 × 2 × 5 (90) | slides / impress | same model both policies | **Not run.** Fix `host_drift` inject timing first. |

Scripted vision “success” is a script hitting the right pixels. It is not evidence that a vision model can do the task. The live pilot is the first same-model measurement; the 90-run is still missing.

### What to run next

1. Decide `host_drift` inject timing so a one-step structured edit still meets `host_diverged`.
2. Do **not** burn the 90-run until that is fixed. The pilot already showed the scripted `contrast_check` split does not hold for `gemini-3.6-flash`.
3. Do not interpret a combined win rate as the headline. Read the category tables.

### Tests

`npm test` is currently **111** tests (Vitest). Impress tests skip or run depending on LibreOffice + fixtures. `npm run typecheck` is clean.

## Current status

**Experimental / Early Stage**

This project is not presented as an established standard. The semantic model, adapter interface, and conformance approach are still being explored.

The immediate priority is not a large specification. It is a small working implementation, contact with one real application, and a measurement that can fail.

This repository currently includes:

- a minimal IR for state, action, validation, effect, revision, and rollback
- a `Session` runtime that validates before mutate
- a small **common core**: `select`, `set_locked`, `delete`
- atomic batches, and undo that reports whether it compensated or restored a snapshot
- host-owned mode: no snapshot overwrite, drift detection, explicit sync, stale `expectedRevision`
- a **lab** adapter (`heater` / `vessel`) as the original stand-in
- a **slides** adapter with PPT-like domain operations: `create_shape`, `set_fill`, `set_text`, `resize`, `align`, plus `duplicate`, `bring_to_front`, `send_to_back`, `group`, `ungroup`
- a **LibreOffice Impress** adapter against a live `.odp`
- relevant-state slices that walk the object tree (current slide, not the whole deck)
- adapter self-description, so an agent can read capabilities instead of probing for them
- the catalog projected as typed tool descriptors, with a dispatcher
- action traces that can be replayed
- a measurement harness: structured vs naive scripts, rollback recovery, batch atomicity, and state size
- a fixed compare protocol (`scir-compare-v0` v3): nine tasks, scripted baseline **and** a live model loop, experiment logs in `schema/experiment.v2.json`
- shared conformance checks against lab, slides, and Impress when LibreOffice is installed
- a JSON schema that real session output is tested against
- a local demo that places pixel space next to structured state

The slides adapter is still in-memory. It is a software-shaped surface, not Microsoft PowerPoint. Resize here means a bounding box, which is intentionally not Blender scale or a CAD constraint. Grouping is the clearest case so far of a domain operation the common core should never learn: it is a slide concept, it has no single inverse action, and `delete` correctly refuses a group that still has members.

The Impress adapter talks to a live LibreOffice document over UNO. It loads committed fixtures instead of factory-seeding a deck. Snapshot restore rebuilds the live document from IR state. That is a declared capability, not a default for every adapter.

## Design principles

1. Use structured state when the application already knows the answer. Don't make an AI infer exact information from pixels when the application can provide it directly.
2. Keep the common core small. Not every application needs to expose the same operations.
3. Validate before modifying. An action should be checked against the available state whenever possible.
4. Make changes observable. The system should be able to describe what changed.
5. Prefer reversible operations. When the underlying application allows it, changes should be recoverable.
6. Measure before making big claims. The project should earn its abstractions through working implementations and benchmarks.

## Roadmap

- [x] Define a minimal IR schema
- [x] Implement State / Action / Result
- [x] Add validation and preconditions
- [x] Add revision tracking
- [x] Explore rollback
- [x] Build the first application adapter (lab scene stand-in)
- [x] Add a software-shaped adapter (slides / PPT-like operations)
- [x] Create basic conformance tests
- [x] Add a first measurement harness (scripted structured vs naive, not yet vs a vision model)
- [x] Add atomic batches and inverse-action recovery
- [x] Measure the size of full state against the relevant slice
- [x] Project the catalog as tool descriptors, so a transport can carry the IR
- [x] Test the published schema against real session output
- [x] Stop assuming the IR owns the document (snapshot restore is a capability, not a default)
- [x] Build an adapter against real software (LibreOffice Impress)
- [x] Fix a compare protocol, task set, scripted vision baseline, and experiment log schema
- [x] Build a live model loop (same model for structured and vision; PNG screenshots; N repeats)
- [x] Stop vision tool results from leaking IR lock fields and object ids
- [x] Run the live pilot (`contrast_check` + `host_drift`, N=5) against `gemini-3.6-flash`
- [ ] Fix live `host_drift` inject timing so structured actually meets `host_diverged`
- [ ] Run the full live 90-run (9 tasks × 2 policies × 5) and read category tables, not the combined rate
- [ ] Optional: same live protocol against Impress
- [ ] Refine the IR based on those measurements, not on the scripted baseline

## What this is not

This project is not intended to be:

- A replacement for MCP
- A replacement for OpenAPI
- A replacement for application APIs
- A GUI automation framework
- A universal command language for every application
- A claim that vision-based agents are obsolete
- A finished industry standard

It is an experiment around a possible missing layer between AI agents and existing software.

## Run it

```bash
npm install
npm test
npm run typecheck
npm run example
npm run example:slides
npm run conformance
npm run tools
npm run example:impress
npm run bench
npm run compare:scripted
npm run compare:dry
npm run compare:pilot
npm run dev
```

`npm run example:impress` starts a headless LibreOffice, opens `fixtures/impress/board.odp`, and runs `set_text` against the live document. Set `SCIR_LIBREOFFICE` if LibreOffice is not in `C:\Program Files\LibreOffice\program`. On Windows the launcher is `soffice.com` with a private `UserInstallation`; `close()` kills only that process tree. Direct `soffice.bin` is not the entry point — it exits without opening `--accept`. `npm run fixture:impress` / `npm run fixture:impress-contrast` rewrite the committed decks from the factory seed; that seed path is not how the adapter runs.

### Compare

Default `npm run compare` is the **live** driver and exits if there is no API key. Use the named scripts on Windows; `npm run compare -- --scripted` is not forwarded by this npm.

| Command | What it does |
| --- | --- |
| `npm run compare:scripted` | Frozen scripts, N=5, slides + Impress if present |
| `npm run compare:dry` | Scripted, N=1 |
| `npm run compare:pilot` | **Live** `contrast_check` + `host_drift`, N=5, slides only. Needs an API key |
| `npx tsx examples/compare.ts --scripted --adapter=slides --repeats=5` | Scripted slides 90-run |
| `npx tsx examples/compare.ts --task=contrast_check --repeats=5 --adapter=slides` | Live one-task subset |

Environment: `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`; `SCIR_COMPARE_MODEL` (`.env` default `gemini-3.6-flash`), `SCIR_COMPARE_PROVIDER`, `SCIR_COMPARE_REPEATS`, `SCIR_COMPARE_ADAPTER`, `SCIR_COMPARE_DRIVER`, `SCIR_COMPARE_TASKS`, `SCIR_COMPARE_DRY_RUN=1`.

Both live policies must share the same model. Splitting models would measure Claude vs GPT, not structured IR vs screenshots.

Task catalog: `docs/tasks.md`. Log schema: `schema/experiment.v2.json`.

`npm run conformance` prints the shared checks for lab, slides, and Impress when LibreOffice and the `.odp` fixture are present, including which recovery mechanism each one used.

`npm run tools` prints the catalog as tool descriptors and runs a few calls through the dispatcher.

`npm run dev` opens a demo with pixel space next to structured state. The default adapter is slides: `create_shape` is a catalog operation, not a drawing primitive. Toggle **relevant only** to see the current slide instead of the whole deck, with the token cost of each shown above the state. Shift-click marks shapes to **Group**. Pasting an array into the action box applies it as one atomic batch, and **Load a batch that must abort** sets up a batch whose accepted prefix gets reverted. **as tools** shows what an agent would be handed. **Measure** runs the harness in the result panel.

## License

TBD

## Contributing

Early experimentation, discussion, and implementations are welcome.

The most useful contributions will likely come from trying the model against real software and discovering where it works — and where it breaks.
