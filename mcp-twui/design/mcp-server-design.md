# MCP server design — `twui` tools for authoring `.twui.xml`

**Status: design only. No code yet.** This spec describes an MCP server that would give an AI assistant
the knowledge (the `knowledge/` docs) and helper actions to author TWUI files reliably, so it doesn't have
to re-derive the format each time.

## Goals & non-goals

- **Goal**: expose the `knowledge/` base as MCP **resources**, plus a handful of **tools** that do the
  mechanical, error-prone parts (scaffolding, byte-validation, GUID generation, template cloning, loc/Cco
  lookups). Together: "the assistant can create correct TWUI files."
- **Non-goal (for v1)**: rendering layouts, running live game data, or replacing the editor. Validation is
  byte/format/well-formedness only; behavioural correctness is verified in-game.

## Runtime & architecture

- **Standalone Node/TS package** at `mcp-twui/server/` (future). The repo is already ESM + TypeScript
  (Vite, `tsc`), so reuse that toolchain. Dependency: `@modelcontextprotocol/sdk`.
- **Transport: stdio** (a local CLI the client spawns). No network needed.
- **Data access: read `games/<GAME>/` directly from the filesystem.** Templates, loc tsvs, `metadata.json`,
  and `ui/cco/*.json` are plain files — the server reads them itself; **no Rust/Tauri dependency** for the
  common path. A `--games-root` (default `games/3K`) and `--out-dir` (default `output/3K`) configure paths.
- **Byte-exact serialize/validate in TS.** Reimplement the rules from `src-tauri/src/model/serialize.rs`
  (documented in `../knowledge/01-file-format.md`) so the server is self-contained. *Optional fallback*: if
  perfect parity is needed, shell out to the Tauri backend's `parse_element` / `serialize_element` /
  `roundtrip_check` commands via a small bridge — but prefer pure TS to avoid requiring the app to run.

Why this shape: the second-explore confirmed there is **no existing MCP infrastructure**, and the heavy
data ops are simple file reads. A thin standalone server is the lowest-friction path.

## Resources (read-only knowledge served to the client)

Static (the docs in this folder), served as MCP resources so the assistant can pull them on demand:
- `twui://knowledge/overview`, `/file-format`, `/versions`, `/attributes`, `/callbacks-cco`, `/tooltips`,
  `/templates-and-data`, `/gotchas`, `/script-bridge` → the `knowledge/*.md` files.
- `twui://recipes/effect-bundle-button`, `twui://recipes/effect-bundle-toggle`, `twui://recipes/purchase-button`
  → the recipe files.

Dynamic (computed from game data):
- `twui://templates` → list of template ids under `games/<GAME>/ui/templates/`.
- `twui://effect-bundles` → effect-bundle keys + titles (from `effect_bundles__.loc.tsv`).

## Tools

Each tool sketch: **name — purpose (inputs → output)**. Inputs/outputs are JSON.

1. **`twui_scaffold`** — generate a minimal valid file.
   `{ version=136, componentTag, componentId, withRootCanvas=true }` → file text (CRLF, tabs, fresh GUIDs).
   Uses the skeleton in `knowledge/00-overview.md`.
2. **`twui_validate`** — check a file/text against the byte + structural rules.
   `{ text | path }` → `{ ok, errors[] }` covering: CRLF integrity (CR==LF, no lone LF, no `0d0d`), tab
   indent, 0/1-inline vs 2+-one-per-line attribute layout, self-closing empties, prolog/tail shape,
   GUID format (8-4-4-16) + hierarchy↔components consistency + currentstate resolves, XML well-formedness,
   and version-attribute compatibility (an attr's `versions` range vs the file's `version`). Mirrors
   `roundtrip_check` + `schema.ts`.
3. **`twui_gen_guid`** — `{ count=1 }` → array of uppercase 8-4-4-16 GUIDs.
4. **`twui_list_templates`** — `{ filter? }` → template ids (+ one-line description where known).
5. **`twui_read_template`** — `{ id }` → the template's component block (tag, images, states) for cloning.
6. **`twui_clone_template`** — the splice method as a tool.
   `{ id, newId, offset?, version=136, extraCallbacks?[], extraStates?[] }` → a self-contained file: root
   canvas + the template's component (renamed) with its images/states/animations spliced verbatim, your
   callbacks injected into `<callbackwithcontextlist>`, optional extra states inserted, normalized to CRLF
   and validated. This is exactly how the two shipped files were built.
7. **`twui_lookup_loc`** — `{ query, table? }` → matching loc rows `{ key, text, tooltip }` from
   `text/db/*.loc.tsv`.
8. **`twui_lookup_effect_bundle`** — `{ query }` → `{ key, title, description }[]` (convenience over
   `twui_lookup_loc` for `effect_bundles__`).
9. **`twui_cco_lookup`** — `{ type }` → that Cco type's functions `{ name, args, returns, doc }[]` from
   `metadata.json` (e.g. `CcoEffectBundle`, `CcoCampaignFaction`).
10. **`twui_recipe`** — `{ name }` → the recipe markdown (so the assistant can follow a worked pattern).

Optional higher-level helpers (v2): `twui_add_effect_bundle_tooltip` (inject the propagator + image setter
+ tooltip setter for a given bundle key), `twui_add_purchased_lock` (inject the `purchased` state +
`ContextStateSetterConditional`), `twui_add_purchase_button` (selection script-object writes + cost/icon
Apply button + affordability/not-owned gate + the purchase event; pairs with a generated Lua link stub).

## Tool → existing-capability mapping (sanity)

Every tool maps to a real capability — direct FS reads, or an existing Rust command we can mirror:

| Tool | Backed by |
|------|-----------|
| scaffold / clone / gen_guid | pure TS (format rules in `01-file-format.md`; `model/guid.rs`) |
| validate | TS reimpl of `serialize.rs` rules + `roundtrip_check` + `schema.ts` version ranges |
| list/read_template | read `games/<GAME>/ui/templates/` (mirrors `load_templates`) |
| lookup_loc / effect_bundle | read `text/db/*.loc.tsv` (mirrors `load_loc`) |
| cco_lookup | read `ui/metadata.json` (mirrors `load_cco_docs`) |
| resources | read this `mcp-twui/` folder + the above |

No tool needs a capability we don't already have in the repo.

## Registration (how the user enables it, once built)

A project- or user-level MCP config, e.g.:
```json
{
  "mcpServers": {
    "twui": {
      "command": "node",
      "args": ["Z:\\Claude\\XMLViewer\\mcp-twui\\server\\dist\\index.js",
               "--games-root", "Z:\\Claude\\XMLViewer\\games\\3K",
               "--out-dir", "Z:\\Claude\\XMLViewer\\output\\3K"]
    }
  }
}
```
(Place in the user's Claude MCP config / `.mcp.json`. None exists today.)

## Phased build plan (ordered by dependency)

1. **Resources only** — serve the `knowledge/` + `recipes/` docs. Immediately useful; zero risk.
2. **Read/lookup tools** — `twui_list_templates`, `twui_read_template`, `twui_lookup_loc`,
   `twui_lookup_effect_bundle`, `twui_cco_lookup`, `twui_gen_guid`. Pure reads.
3. **`twui_validate`** — port the byte/structure/version checks. Reuse the editor's roundtrip test fixtures
   to confirm parity.
4. **`twui_scaffold` + `twui_clone_template`** — the generators (depend on validate for self-check).
5. **v2 helpers** — `twui_add_effect_bundle_tooltip`, `twui_add_purchased_lock`, and any new recipes.

## Open questions for whoever builds it

- Pure-TS serializer parity vs the Tauri bridge — start pure TS; add the bridge only if a round-trip diff
  ever disagrees with `serialize.rs`.
- Multi-game (`3K` vs `WH3`) — `--games-root` already parameterizes this; version defaults differ (136 vs
  142), so `twui_scaffold`/`twui_validate` should take/infer `version`.
- Whether to also expose `output/3K/` writes as a tool, or leave file-writing to the assistant's normal
  filesystem access (recommended: leave writes to the assistant; keep the server read+compute only).
