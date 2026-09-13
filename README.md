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
      used when the adapter cannot express an inverse
```

Compensation is the one that could survive contact with real software, where the IR does not own the document and cannot simply overwrite it. Snapshot restore is the fallback. Asking an adapter to declare which one it can offer is more honest than assuming undo works.

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

Both adapters pass all of them, and they do not pass them the same way: slides falls back to a snapshot restore where lab can compensate with an inverse action. That difference is the point of running the same checks against both.

This is currently a proposed direction, not an established specification.

## The main question

The project is ultimately trying to answer one question:

> Can a small semantic layer make AI-controlled software more predictable, inspectable, and recoverable than relying only on screenshots or unrestricted application-specific code?

I don't know the answer yet. That's the reason for building this project.

## First experiment

The first goal is not to support many applications. It is to build one reasonably complete adapter and see whether the idea actually helps.

A first experiment could compare:

```
Vision / UI-based Agent
        vs.
Structured State + Software Control IR
```

Possible measurements:

- Task success rate
- Token usage
- Number of tool calls
- Invalid actions
- Execution latency
- State errors
- Recovery after failure
- Rollback success

The purpose of the experiment is not to prove that IR is better. It is to find out where it helps, where it doesn't, and what the model needs to change.

## Current status

**Experimental / Early Stage**

This project is not presented as an established standard. The semantic model, adapter interface, and conformance approach are still being explored.

The immediate priority is therefore not to define a large specification. It is to build a small working implementation and discover what survives contact with real software.

This repository currently includes:

- a minimal IR for state, action, validation, effect, revision, and rollback
- a `Session` runtime that validates before mutate
- a small **common core**: `select`, `set_locked`, `delete`
- atomic batches, and undo that reports whether it compensated or restored a snapshot
- a **lab** adapter (`heater` / `vessel`) as the original stand-in
- a **slides** adapter with PPT-like domain operations: `create_shape`, `set_fill`, `set_text`, `resize`, `align`
- relevant-state slices that walk the object tree (current slide, not the whole deck)
- PPT-like domain extras on slides: `duplicate`, `bring_to_front`, `send_to_back`, `group`, `ungroup`
- adapter self-description, so an agent can read capabilities instead of probing for them
- the catalog projected as typed tool descriptors, with a dispatcher
- action traces that can be replayed
- a measurement harness: structured vs naive scripts, rollback recovery, batch atomicity, and state size
- shared conformance checks against both adapters
- a JSON schema that real session output is tested against
- a local demo that places pixel space next to structured state

On a 48-object deck, the relevant slice is 6 objects and about 13% of the tokens of the full document. That is a measurement of the representation, not of an agent; it says how much state an agent would be handed, not how well it would then perform.

The slides adapter is still in-memory. It is a software-shaped surface, not Microsoft PowerPoint. Resize here means a bounding box, which is intentionally not Blender scale or a CAD constraint. Grouping is the clearest case so far of a domain operation the common core should never learn: it is a slide concept, it has no single inverse action, and `delete` correctly refuses a group that still has members.

The next useful step is an adapter against real software.

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
- [ ] Build an adapter against real software
- [ ] Benchmark against existing approaches
- [ ] Refine the IR based on actual implementations

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
npm run bench
npm run dev
```

`npm run bench` runs scripted policies against the slides adapter. It does not yet compare IR to a vision model. It measures invalid actions, goal checks, rollback, batch atomicity, and state size on known tasks.

`npm run conformance` prints the shared checks for both adapters, including which recovery mechanism each one used.

`npm run tools` prints the catalog as tool descriptors and runs a few calls through the dispatcher.

`npm run dev` opens a demo with pixel space next to structured state. The default adapter is slides: `create_shape` is a catalog operation, not a drawing primitive. Toggle **relevant only** to see the current slide instead of the whole deck, with the token cost of each shown above the state. Shift-click marks shapes to **Group**. Pasting an array into the action box applies it as one atomic batch, and **Load a batch that must abort** sets up a batch whose accepted prefix gets reverted. **as tools** shows what an agent would be handed. **Measure** runs the harness in the result panel.

## License

TBD

## Contributing

Early experimentation, discussion, and implementations are welcome.

The most useful contributions will likely come from trying the model against real software and discovering where it works — and where it breaks.
