# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-12

First public release.

### Added
- 8 consolidated tools: `vp_open`, `vp_shapes`, `vp_build`, `vp_edit`, `vp_inspect`,
  `vp_save`, `vp_screenshot`, `vp_eval`.
- Server `instructions` with every convention stated once (arrow direction, rows, refs,
  auto-placement), so tool descriptions stay one line long.
- One `rows` field for every compartment (attributes, operations, ER columns with `PK`/`FK`,
  enumeration literals, triggers, procedures, swimlane partitions).
- `mult` and `roles` as `[from, to]` pairs on connectors.
- Attached shapes: ports and pins on the border of their parent, lanes stacked in pools.
- Sequence messages stacked top-down in order; self messages drawn as loops.
- Parallel connectors between the same two elements fanned out automatically.
- Readable connector texts: names beside the line, multiplicity and role of each end on
  opposite sides (VP draws them all centred on the line, on top of each other).
- Typed BPMN tasks (UserTask, ServiceTask...) sized so the name clears the task icon.

### Fixed
- Multiplicities and roles set on a connector without a name were stored but not drawn
  until the diagram was reloaded.
- After an auto-layout, connector waypoints were left behind (lines bending into shapes or
  into empty space): they now move with the shapes, and non-hierarchical layouts clear them.
- Screenshots no longer include VP's page-resource icon or the canvas scrollbars.
- Auto-placement without overlaps; containers grow to fit their children.
- `vp_inspect` with short `#id`s, `detail:"brief"`, `filter`, `ref` and `limit`.
- Cropped screenshots, written to disk with `path` so they cost no image tokens.
- Detection of an expired VP session (`NOT SIGNED IN`), retry after a page reload,
  serial call queue and timeouts.
- One tested example per diagram type in `examples/`.
- End-to-end suite (220 checks against VP Online) and an offline smoke test for CI.
- Registry metadata (`server.json`, `mcpName`).

### Changed
- Every phase of a build runs in one model transaction, with rendering paused:
  8–10× faster on large diagrams.
- While building, VP's per-change search of the canvas DOM for its 3D-character host is
  skipped, and end texts are created directly instead of through a label edit (about half
  the cost).

## [1.0.0]

Initial private version (12 tools).

[2.0.0]: https://github.com/ibsorn/vp-online-mcp/releases/tag/v2.0.0
