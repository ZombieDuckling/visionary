# Position-Addressed Memory Guide

Visionary should not reach for embeddings or a vector database before the workflow has a stable folder and process shape. Most shipping workflows remember context more cheaply, more safely, and more portably when the structure itself — folders, paths, filenames, cascading instructions, templates, and local routing files — carries the meaning.

Use this guide when designing how an agent or workspace remembers, retrieves, or reuses context across sessions.

## Address modes

| Mode | Mechanism | Best for | Visionary implication |
|---|---|---|---|
| Position-addressed | Folders, paths, filenames, cascading CLAUDE.md/README, templates, local routing files | Repeated stages/deliverables, human-inspectable work, provider portability | Lay out the workspace so a fresh session can orient from the tree alone; `~/Visionary/<project>/task-<id>` is the local instance |
| Link-addressed | Wiki/entity graph, maintained notes, explicit cross-links | Cross-cutting discovery where relationships change | Add only when position location no longer predicts the relevant context |
| Content-addressed | Embeddings, vector DB, semantic/similarity search | Large or messy corpora, hidden-fact lookup | Add only when the folder/process shape cannot solve the immediate retrieval job |

Position first is a default, not a rule: escalate to link- or content-addressed memory when the job genuinely needs it.

## Workbench layout

A position-addressed workbench should include:

- **Front desk:** root `README.md` or `CLAUDE.md` orientation.
- **Canonical manifest:** work items, statuses, source links, and outputs.
- **Cascading context:** root instructions plus project/client/stage-specific context files.
- **Templates/primitives:** reusable starting shapes for common outputs.
- **Source vs derived separation:** raw/source material kept apart from notes, decisions, outputs, and scripts.
- **Review surface:** diffs, checklists, acceptance criteria, human-editable artifacts.
- **Portability constraint:** do not hide core workflow state inside one vendor's chat/memory store.

## Required review questions

Before building a memory or retrieval feature, answer these in the plan or PR notes:

- Which address mode does the job actually need: position, link, content, or hybrid?
- Can a folder/path/routing-file structure solve the immediate retrieval job?
- What is always loaded versus loaded only for the task?
- Which material is raw/untrusted evidence, and which files may instruct the agent?
- How does a fresh session orient without replaying prior chat?
- Where will durable state live so it survives a model or provider swap?

## Anti-patterns

- Building embeddings before the workflow has a stable folder/process shape.
- Putting all context in one giant file or chat transcript.
- Generating creative/business assets into flat, uneditable piles.
- Using vendor memory features for core state that should be portable.
- Hiding business process in implicit human habit without writing routing files.

## Product direction

Visionary should treat repo and folder layout as model-readable instruction, not mere storage. The dashboard's job is to make the workspace tree, cascade, and manifest visible enough that the operator can see where an agent's context came from — and to keep that structure portable rather than locked into one harness.
