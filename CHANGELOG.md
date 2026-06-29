# Changelog

Notable changes per release. The section for a tagged version becomes that release's notes,
shown in the app's update prompt (Settings -> About / Updates and the startup banner).

## [0.0.6] - 2026-06-28

### Added
- **Create new TWUI files** — a **New** menu (toolbar, or `Ctrl+N`) makes a blank, valid layout in
  an untitled tab: an empty root sized to the render resolution, with a selectable layout version.
  **New from file** clones an existing file into a fresh untitled doc to modify. Untitled files are
  kept in memory until you Save As.
- **Insert parts from another file** — an **Insert from file** picker (Hierarchy right-click empty
  space, the New menu, or a Pack Files entry's menu) lets you choose any `.twui.xml` (pack browser or
  disk; templates included), browse its component tree, and drop a component — with its whole subtree
  and component definitions — into the file you're editing, under the selected component (or the
  root). All GUIDs are regenerated on insert so nothing collides, and the part's images, templates,
  and script bindings come along and resolve.
- **Open multiple files at once** — a tab strip at the top of the Hierarchy panel holds every
  open `.twui.xml`; click a tab to switch the active file (all panels follow it), `x` to close,
  `+` to open another. Opening a file (toolbar or Pack Files) now adds a tab instead of
  replacing the current one. Switching is lossless — each file keeps its own selection,
  undo/redo, and unsaved edits in memory; a `*` marks unsaved tabs. Drag a tab to reorder it
  (which also reorders the layer stack). With "Reopen last file on launch" enabled, the whole
  working set restores next launch.
- **Right-click context menus** — components (in the Hierarchy tree and on the canvas) offer
  Duplicate, Delete, Show/Hide, Copy, Paste, and a Regenerate GUIDs submenu (this component /
  including children); empty Hierarchy space offers Paste, Regenerate all GUIDs, and Expand /
  Collapse all; file tabs offer Save, Save As, show/hide as layer, and Close / Close Others /
  Close All; the Layers panel offers Make Active, Show/Hide, Move to Top/Bottom, and Close; and
  Pack Files entries can be opened as a single layout or onto the top/bottom layer (added as a
  reference layer while the file you're editing stays active).
- **Composite layouts as layers** — a new **Layers** panel stacks open files in one visualizer
  like image layers (top entry draws on top), so you can view e.g. a campaign HUD with a schemes
  panel together and align them in a shared screen space. Toggle each file's eye to show/hide it
  as an overlay (the file you're editing always renders); drag to reorder the z-order. Clicking a
  component on any visible layer makes that file active and selects it. Overlays draw at full
  opacity; selection/hover/bounds show only for the active file. The visible set and order
  restore on launch with the working set.

- **Character portraits render masked and aspect-correct** — a `maskimage` stencil now alpha-clips
  the portrait it covers (e.g. a faction leader) and the portrait is fitted to its holder instead of
  stretched, matching the in-game shape rather than showing an opaque block.
- **Alternative unit cards** — a "Alt cards" toggle in the Script panel mirrors the game's
  `ui_alternative_unit_cards` preference, flipping unit-card components to their `alternative` art.
- **List skeletons for unbound panels** — when no script pack is connected, a data-bound list now
  shows its template once as a layout skeleton (a "Skeleton" toggle in Perspective); suppressed in
  Simulation/Tooltip, which still mirror the game exactly.
- Faction-leader / heir portraits resolve through a propagated `PlayersFaction.<Role>Context`, so
  those roles are assignable and render without a connected script.

### Changed
- Multiple `ContextImageSetter`s on one component now each override their own image slot (via
  `image_index`), so e.g. a card's base and alternative art swap independently.
- Pooled-resource tier lists (`RangedTierList`) and a tier's filtered `item_list` now resolve their
  rows for preview; hairline textureless quads (divider lines) draw as solid colour fills.

### Fixed
- **Editing an image-metric (size, colour, offset, image) now takes effect** — the draw entries
  under a state's Images carry no GUID of their own, so the Inspector's edits silently went nowhere
  and the Visualizer never changed. They're now edited by position, so changing a State image's
  width/height (the size that actually drives the on-screen draw), colour, offset, or which component
  image it uses updates live. (The "Component images" size is the source texture size; the State
  image size wins for drawing.)
- **Renaming a component's id now renames its element tags too** — changing `id` in the Inspector
  updates the `<id>…</id>` open/close tags in both the hierarchy and components sections (not just the
  attribute), so the tree label and saved XML stay in sync. If the id starts with a digit (invalid for
  an XML tag) the tag is `_`-prefixed — `id="3k_panel"` keeps that id but uses the tag `<_3k_panel>` —
  while an id that still can't form a valid tag (e.g. with a space) updates only the attribute.
- **Images from an overlay pack now render** — the Visualizer cached images for the whole session and
  never refreshed them when the image source changed, so an overlaid `.pack`'s images (and switching
  game / data folder / vanilla↔mods) showed stale or missing art. Changing the source now drops the
  image cache and re-fetches.

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
