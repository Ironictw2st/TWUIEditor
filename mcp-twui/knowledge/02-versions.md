# 02 — Layout versions (129 / 135 / 136 / 142)

The `<layout version="N">` stamp. Source of truth: `src/docs/twui-versions.md`, `src/twui/migrate.ts`,
`src/twui/schema.ts` (`versions: {min?, max?}` per attribute).

| Version | Game | Notes |
|---------|------|-------|
| **129** | 3K | one legacy file in the data set |
| **135** | 3K | common base |
| **136** | 3K | **additive patch over 135** — author new 3K files at 136 |
| **142** | Warhammer 3 | the real break from 136 (removals + 3D-model family) |

> The `.twui` (no `.xml`) Lua-table templates at versions 101/105/110 are a **separate legacy format**;
> `version=21-27` files are cutscene camera scripts, not layouts. Ignore those for authoring.

## 135 → 136 (additive only — safe)

136 adds attributes; it removes nothing. New in 136:
`font_colour_override_preset_key`, `is_dev_only`, `allow_scale_items_down`, `autocalc_rows`, `arc`, and the
animation targets `targetmetrics_m_font_scale` / `_imageindex1` / `_imageindex2`. Everything valid in 135
is valid in 136, so authoring a 136 file using 135-era attributes (as we do — cloning the 135 template
`3k_btn_medium`) is fine.

## 136 → 142 (the real break)

**Removed in 142** (present ≤136, so do NOT use these in a 142 file; conversely they're fine in 136):
- `isaspectratiolocked` (replaced by the enum `aspect_ratio_locked_behaviour` =
  `Width First` | `Biggest` | `Smallest` | `Only Width`)
- `font_m_tracking`
- `canuse1bitalpha`
- `matchfontsizes`
- `renderwhendragged`
- `renderlastonfocused`
- the `<localisation_changes/>` element (so a v142 file's tail is `</components>` → `</layout>`)

**Added in 142**: the 3D-model element family `component_model_view` → `model_list` → `ComponentModel` →
`animation_paths`/`path` (camera / lighting / skeleton attrs), plus `text_clip_behaviour`,
`central_alignment`, `equal_spacing_size`, `even_distribution`, `resize_children`,
`is_using_variable_line_length`, `uniqueguid_in_template`, `create_ingame`, `component_level_text`.

## Practical guidance

- **Authoring for 3K → use `version="136"`.** Keep `<localisation_changes/>` in the tail. `isaspectratiolocked="true"`
  is valid and used (the round buttons set it).
- **Do not** put 142-only attributes (3D model family, `aspect_ratio_locked_behaviour`, etc.) in a 136 file,
  and do not put 142-removed attributes in a 142 file.
- Conversion 136↔142 is implemented in the editor (`src/twui/migrate.ts`, `migrateLayout()`), opt-in via
  Settings → Experimental; it renames `isaspectratiolocked`, drops the removed attributes, and deletes
  `<localisation_changes/>`. Treat it as a reference for what changes between versions.
