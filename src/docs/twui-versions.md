# TWUI layout versions

The `version` attribute on the root `<layout>` element identifies the `.twui.xml` format
revision. This is a living reference — add notes here as new differences are found.

## Version landscape

- **129** — legacy 3K straggler (a single file). Read but not offered as a conversion target.
- **135** — Three Kingdoms (3K) base revision.
- **136** — 3K, a later patch revision. Additive over 135 (nothing removed).
- **142** — Warhammer 3 (WH3). The real format break.

Out of scope: the `.twui` (no `.xml`) Lua-table templates at versions 101/105/110 are a
separate legacy format, and `version="21".."27"` files are cutscene camera scripts, not layouts.

## 135 to 136 (3K patch — additive only)

Adds:

- `font_colour_override_preset_key` — named colour preset overriding the font colour.
- `is_dev_only` — component exists only in dev builds.
- `allow_scale_items_down`, `autocalc_rows`, `arc` — LayoutEngine options.
- `targetmetrics_m_font_scale`, `targetmetrics_m_imageindex1`, `targetmetrics_m_imageindex2` —
  new animation interpolation targets (font scale, image-frame swap).

Nothing is removed in this step.

## 136 to 142 (3K to WH3 — the break)

Net **+33 / -9** attributes.

### Removed (absent in 142)

- `isaspectratiolocked` (bool) — **replaced** by the enum `aspect_ratio_locked_behaviour`
  (`Width First` / `Biggest` / `Smallest` / `Only Width`).
- `font_m_tracking` — font letter tracking.
- `canuse1bitalpha` — 1-bit alpha image flag.
- `matchfontsizes` — LayoutEngine font-size normalisation.
- `renderwhendragged`, `renderlastonfocused` — render flags.
- The `<localisation_changes/>` trailing element.

### Added

- **3D model element family** — `component_model_view` -> `model_list` -> `ComponentModel` ->
  `animation_paths`/`path`. The WH3 portrait "portholes" that render live models, with camera
  (`camera_dist`, `camera_fov`, `camera_phi`, `camera_theta`, `camera_target`), lighting
  (`ambient_light_m_ambient_cube_*`, `directional_light_m_*`), and model/anim attributes
  (`num_models`, `num_anims`, `skeleton_type`, `current_animation_name`, ...).
- Layout / template attributes: `aspect_ratio_locked_behaviour`, `text_clip_behaviour`,
  `central_alignment`, `equal_spacing_size`, `even_distribution`, `resize_children`,
  `is_using_variable_line_length`, `uniqueguid_in_template`, `create_ingame`,
  `component_level_text`.

## How the editor uses this

- The attribute schema (`src/twui/schema.ts`) tags each attribute with the versions it is valid
  in, so the Inspector only offers in-version attributes and flags out-of-version ones.
- Conversion between versions is **experimental** and available only on the **root** component
  (enable it in `Settings > Experimental`). It renames/removes per the rules above and is a single
  undoable step. Converting intentionally changes the file's bytes.
