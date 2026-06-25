# Changelog

Notable changes per release. The section for a tagged version becomes that release's notes,
shown in the app's update prompt (Settings -> About / Updates and the startup banner).

## [Unreleased]

## [0.0.5] - 2026-06-25

### Added
- **Read directly from `.pack` files** — point the tool at a Total War install's `data` folder and
  open layouts straight from the packs, no extraction needed. Packs auto-load in load order;
  vanilla-only by default with a toggle to include mods.
- **Pack Files panel** — a dockable browser to filter and click through layouts in the loaded
  pack(s), with an option to **overlay a single `.pack`** on top (e.g. to inspect one mod) and clear
  it again.
- **Game data from packs via your RPFM schema** — point Settings → RPFM schema at your local
  `schema_*.ron` and the faction/culture/campaign and character pickers, localised text, and
  court-office titles all populate in pack mode (binary db + `.loc` decoded on the fly).
- **Per-game paths** (Settings → Game & Data) — set a loose "Outside" folder and a "Data" pack
  folder for each game; selecting a game applies its path, and the last source + read mode are
  restored on the next launch.
- **Loading screen** stays up until all game data has finished loading.
- Hovering a Hierarchy row now highlights the row and outlines that component in the Visualizer (and
  vice-versa).
- Program version shown next to the toolbar logo; curated patch notes now ship with each update and
  render in the in-app update prompt.

### Changed
- Switching the data source (vanilla ↔ mods, overlay, game) is instant via cached pack indexes and
  no longer freezes the window while a large install is indexed.

### Fixed
- **Select tool / hover** now picks the component under the cursor instead of a large container that
  merely spans it (notably on the court-screen panels).
- **Unsaved-changes prompt** — switching files or closing the app with unsaved edits now asks to
  Save / Save As / Don't Save / Cancel instead of silently discarding them.
- **Tool palette** stays on-screen when other panels are resized over it (sticks to the edge).
- Faster loose-folder loading (removed redundant directory scans).
- Stability: certain DDS textures no longer crash the app, and malformed/unsupported packs are
  skipped safely.

## [0.0.4] - 2026-06-23

- Internal test release (version bump to validate the self-updater); no user-facing changes.

## [0.0.3] - 2026-06-23

### Added
- Light / Dark theme that follows the system setting, plus accent colour and a compact
  density (Settings -> Theme).
- Movable and hidable tool palette in the Visualizer.
- Render-resolution selector (Perspective) with resolution-aware reflow of edge-docked panels.
- Hierarchy: force-show toggle to reveal a component hidden by a script/context binding.
- New shortcuts: Open (`Ctrl+O`), Save As (`Ctrl+Shift+S`), Simulate, Tooltip; plus a manual
  **Check for updates** (Settings -> About / Updates).

### Changed
- Switched to a portable, self-updating build (replaces the installer-based updater).

### Fixed
- Hierarchy: items under the same parent now align at the same indent.
- Components hidden by a script/context binding are dimmed in the Hierarchy and no longer
  reserve a layout slot.
- Visualizer no longer re-fits the view on every edit.
