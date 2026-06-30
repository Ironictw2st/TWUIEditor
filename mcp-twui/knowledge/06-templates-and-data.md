# 06 — Templates & game data

## Templates (reuse these — don't hand-build widgets)

Reusable widgets live as complete `.twui.xml` files in **`games/3K/ui/templates/<template_id>.twui.xml`**.
Each is a full layout (its own `<hierarchy>` + `<components>`) describing one widget with all its states,
images, and animations. Useful button templates:

| Template | What it is |
|----------|-----------|
| `3k_btn_medium` | round 50×50 medium button: frame + backplate + off/on/hover highlights, states `active`/`down`/`down_off`/`hover`/`inactive`/`script_locked`, a `Button` callback, `dynamic_image=0` |
| `3k_btn_medium_toggle` | toggle version of the above: adds `selected` / `selected_down` / `selected_down_off` / `selected_hover` / `selected_inactive` and a glow `<animations>` block; press toggles `active`↔`selected` via transition maps |
| `3k_btn_common_text` | labelled text button |
| `template_effect_bundle` | the in-game effect-bundle icon (defined inside `units_panel.twui.xml` / `province_panel.twui.xml`, not a standalone template file) |

**Two ways to use a template:**
1. **Clone it (self-contained)** — copy its component (images + states) into your file via the *splice
   method* (`01-file-format.md`). The editor renders it directly; no template resolution needed. This is
   what we do for `output/3K/effect_bundle_button*.twui.xml`.
2. **Reference it (templated instance)** — in a parent layout, a child with `part_of_template="true"` +
   `template_id="<id>"` pulls visuals from the template file. The instance carries `dimensions`,
   `<state_uniqueguids>` (state-name → GUID), `<component_image_uniqueguids>`, and `<override_images>`
   (positional `imagepath` overrides). The editor resolves these (`src/twui/template.ts`). More compact but
   needs the template present and is harder to author by hand.

The `dynamic_image=0` userproperty on the button templates marks **image slot 0** (`ph_medium_button_icon`)
as the dynamic icon — a `ContextImageSetter` replaces it at runtime (e.g. with a bundle's `IconPath`).

## Localisation (`.loc.tsv`)

Real UI strings live in **`games/3K/text/db/*.loc.tsv`** — tab-separated `key \t text \t tooltip`. Record
strings are keyed by `<table>_<column>_<recordkey>`. Examples relevant here:
- `effect_bundles__.loc.tsv` → `effect_bundles_localised_title_<key>` and `effect_bundles_localised_description_<key>`.
  e.g. `effect_bundles_localised_title_3k_main_effect_bundle_public_order_outraged_outlaws` = "Outraged".
- The editor's `RECORD_LOC` registry (`src/twui/recordLoc.ts`) maps a Cco record property to its loc
  prefix, so `EffectBundleFromKey(key).Name` resolves to the title string.

To find a usable effect-bundle key: grep `effect_bundles_localised_title_` in
`games/3K/text/db/effect_bundles__.loc.tsv`.

## Cco metadata (`metadata.json`)

**`games/3K/ui/metadata.json`** (~483 KB) is CA's machine-readable Cco type system: each type (e.g.
`CcoCampaignFaction`, `CcoEffectBundle`, `CcoCampaignRoot`) lists its functions with `name`, `doc`,
`arguments`, `return_type`. Use it to discover what a context exposes. Examples we relied on:
- `EffectBundleFromKey(String, Int?) -> CcoEffectBundle` (a global factory; ~line 21551).
- `EffectBundleList(bool?) -> [CcoEffectBundle]` on `CcoCampaignFaction` / `CcoCampaignCharacter` /
  `CcoCampaignMilitaryForce`.
- `CurrentTooltip -> UniString` on `CcoComponent` (what `ContextTooltipSetter` sets; ~line 11856).
- Root types: `CcoBattleRoot` (~908), `CcoCampaignRoot` (~8623), `CcoFrontendRoot` (~15427).

## Cco shorthand macros (`ui/cco/*.json`)

**`games/3K/ui/cco/<lowercase-type>.json`** define content-side shorthand expressions usable in
`context_function_id` (e.g. `ccocampaigncharacter.json`). Format: `{name, return}` (simple) or
`{name, select:[{cond,ret},…]}` (conditional). The editor expands them (`src/twui/cco.ts`).

## Directory layout (3K)

```
games/3K/
  ui/
    templates/             reusable widgets (<id>.twui.xml)
    common ui/             shared layouts incl. tooltip layouts (tooltip_context_effect_list, …)
    campaign ui/           campaign panels (units_panel, 3k_dlc07_*, character_details, …)
    battle ui/  frontend ui/  content_popups/  dev_ui/
    skins/default/         .png art (button frames, icons, backplates, …)
    cco/                   *.json shorthand macros
    metadata.json          Cco type/function signatures
    background/            backgrounds (editor visualizer)
  text/db/                 *.loc.tsv localisation
  DB/                      RPFM db tables (factions, cultures, …)
output/3K/                 <- author new files here
```

`games/<GAME>/` is the multi-game root; `3K` and `WH3` both exist. The editor's `data_root` points at the
selected `games/<GAME>`. Author output into `output/3K/`.
