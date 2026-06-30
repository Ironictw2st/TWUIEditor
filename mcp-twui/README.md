# mcp-twui — TWUI authoring knowledge base + MCP server design

This folder captures **everything needed to author Total War: Three Kingdoms `.twui.xml` UI files from
scratch**, plus a design spec for an MCP server that would expose this knowledge (and helper tools) to an
AI assistant so it can reliably create TWUI files.

It is **documentation only** right now — there is no server code yet. The `design/` spec describes the
server to build later.

## Why this exists

The `.twui.xml` format is undocumented by the game and full of non-obvious rules (byte-exact round-trip
formatting, a callback/"Cco" expression system, tooltip-trigger mechanics that are easy to get wrong).
This knowledge was worked out by reading the game's shipped UI files and by trial-and-error in-game. It
was scattered across the editor's source (`src/twui/`, `src-tauri/src/model/`), one in-app doc
(`src/docs/twui-versions.md`), and `.claude` memory files. Here it is consolidated and self-contained.

## Layout

```
mcp-twui/
  README.md                     <- you are here
  knowledge/
    00-overview.md              what TWUI is; the two GUID-linked structures; how to start
    01-file-format.md           byte conventions, the minimal skeleton, GUIDs, the "splice" method
    02-versions.md              layout versions 129/135/136/142 and their diffs
    03-attributes.md            attribute registry by element kind + version ranges + enums
    04-callbacks-cco.md         <callback_with_context>, context ids, the Cco expression language
    05-tooltips.md              how tooltips trigger (the hard part) — read before wiring any tooltip
    06-templates-and-data.md    templates, loc tsvs, metadata.json, cco macros, data paths
    07-gotchas.md               the traps, consolidated
    08-script-bridge.md         UI ↔ Lua: fire events, ScriptObjectContext bridge, campaign API (spend/grant)
    recipes/
      effect-bundle-button.md   round button showing an effect bundle's icon + full effect-list tooltip
      effect-bundle-toggle.md   toggle variant + "purchased" lock (disabled when faction owns the bundle)
      purchase-button.md        select-then-buy: script-object selection, cost/icon Apply button, refresh
  design/
    mcp-server-design.md        resources, tools, architecture, phased build plan
```

## How to use it (as a human or an MCP client)

1. New to the format? Read `knowledge/00-overview.md` then `01-file-format.md`.
2. Authoring a specific widget? Jump to `knowledge/recipes/` for a working, annotated example.
3. Wiring a tooltip or data binding? Read `05-tooltips.md` and `04-callbacks-cco.md` first — these are
   where most mistakes happen.
4. Building the MCP server? See `design/mcp-server-design.md`.

## Source of truth & keeping in sync

Each doc is self-contained but cites the authoritative source in the editor repo. When the editor changes,
re-check against these:

| Topic | Source of truth |
|-------|-----------------|
| Byte/serialization rules | `src-tauri/src/model/serialize.rs`, `parse.rs`, `mod.rs` (roundtrip tests) |
| Version diffs | `src/docs/twui-versions.md`, `src/twui/migrate.ts` |
| Attribute registry | `src/twui/schema.ts` |
| Callbacks / Cco evaluator | `src/twui/cco.ts`, `tooltip.ts`, `recordLoc.ts` |
| Cco type/function signatures | `games/3K/ui/metadata.json` |
| Worked examples | `output/3K/effect_bundle_button.twui.xml`, `effect_bundle_button_toggle.twui.xml`, `ironic_acupunture.twui.xml` (+ `ironic_acupunture_purchase.lua`) |

## Status

- Knowledge base: complete (this session's findings + consolidated repo knowledge).
- MCP server: **design only** — not built.
