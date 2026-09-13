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
- Domain catalogs may name similar ideas differently. `resize` on slides is a bounding box, not a universal command.
- Invalid actions must be rejected before adapter state changes.
- Every accepted action should report effects and a revision.
- A recovery must say how it recovered. An inverse action and a snapshot restore are not the same promise, and a real application may only offer one of them.
- Do not advertise snapshot restore unless the adapter can actually overwrite the host document. Inverse-only recovery moves the revision forward.
- Host-owned documents can change out of band. Detect that drift, refuse further actions, and require an explicit sync.
- A batch must leave no changes behind when it aborts. If it cannot, say the state is dirty instead of claiming atomicity.
- Test the published schema against real session output, or delete the schema.
- The first adapter should stay complete enough to measure, not broad enough to impress.
- A real application owns its document. Do not advertise snapshot restore unless the adapter can actually overwrite the host.
