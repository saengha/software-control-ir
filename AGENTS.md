# Software Control IR

This repository is an experiment, not a standard.

The question: can a small semantic layer make AI-controlled software more predictable, inspectable, and recoverable than screenshots or unrestricted application-specific code?

## Design principles

1. Use structured state when the application already knows the answer.
2. Keep the common core small. Domain-specific operations live in adapters.
3. Validate before modifying.
4. Make changes observable (effects, before/after, revisions).
5. Prefer reversible operations when the application allows it.
6. Measure before making big claims.

## What this is not

Not a replacement for MCP, OpenAPI, application APIs, GUI automation, or a universal command language. MCP may transport the IR later. Adapters translate to native APIs.

## Working rules

- Prefer a smaller IR that survives contact with software over a larger vocabulary that looks complete.
- Do not add operations to the common core unless two adapters need the same semantic.
- Invalid actions must be rejected before adapter state changes.
- Every accepted action should report effects and a revision.
- The first adapter should stay complete enough to measure, not broad enough to impress.
