# TWUI Editor

A desktop viewer/editor for **Total War: Three Kingdoms** `.twui.xml` UI layout
files. Three synced panels:

- **Hierarchy** (left) — the component tree; select, add child, duplicate,
  delete, and drag to reparent/reorder.
- **Visualizer** (center) — a canvas preview rendered from the layout using the
  real game images; pan (drag), zoom (wheel), click to select.
- **Inspector** (right) — edit the selected component's attributes, its states
  (size/text/font/colour/shader), and its images.

Saving writes byte-identical `.twui.xml` (verified by round-trip tests on the
1 MB `campaign_hud_faction_header.twui.xml` primary fixture).

## Requirements

- Node 18+ and Rust (stable, MSVC toolchain on Windows) + WebView2 runtime.

## Run (dev)

```bash
npm install
npm run tauri dev
```

The app auto-detects the unpacked `3K` data folder next to the project so images
resolve out of the box. If not found, set it via the toolbar's **3K Root**
button (pick the folder that contains `ui/`).

## Build

```bash
npm run tauri build
```

## Tests

Round-trip fidelity (parse → serialize is byte-identical):

```bash
cd src-tauri && cargo test roundtrip
```

## Architecture

- **Rust backend** (`src-tauri/src/`)
  - `model/` — `quick-xml` parse/serialize into a fidelity-preserving raw
    element tree (ordered attributes, CRLF/tab formatting, self-closing
    preserved). `guid.rs` generates TWUI's `8-4-4-16` GUIDs.
  - `image.rs` + `twuiimg://` protocol (in `lib.rs`) — resolves an `imagepath`
    against the 3K root, sandboxed, PNG passthrough, LRU-cached. `.dds` decode is
    feature-gated (`--features dds`); no layout references `.dds`.
  - `commands.rs` — `read_layout`, `save_layout`, `roundtrip_check`,
    `get/set_data_root`, `image_status`.
- **Frontend** (`src/`) — React + Vite + TS, Zustand+immer store with undo/redo.
  - `twui/doc.ts` + `twui/mutate.ts` — navigate/mutate the raw tree (keeps
    `<hierarchy>` and `<components>` consistent; regenerates GUIDs on duplicate).
  - `layout/compute.ts` — absolute rects from docking + offset + anchor, with a
    basic `LayoutEngine` (List/HorizontalList) stacker.
  - `panels/` — TreePanel, InspectorPanel, VisualizerPanel.

## Known refinement areas

- **External docking** is currently treated like its non-external edge (the
  anchor/offset place the child outside); calibrate against in-game references
  if positions look off.
- **LayoutEngine** stacking is approximate (spacing/reverse handled;
  `sizetocontent`, `columnwidths`, `RadialList` not yet).
- Draw order is hierarchy DFS (parents behind children); per-`priority`
  global ordering is not yet applied.
- Image tint uses the colour's alpha only (no RGB multiply); 9-slice borders are
  stretched.
# TWUIEditor
