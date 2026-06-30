# 03 — Attribute registry (by element kind, with version ranges & enums)

The editor encodes a version-aware attribute schema in **`src/twui/schema.ts`** (each `AttrSchema` has a
kind, type, optional `versions: {min?, max?}`, enum, and category; `attrInVersion`, `schemaFor`,
`attrsFor` apply it). This doc summarizes it. When in doubt, `schema.ts` is authoritative.

Notation: `(≤136)` = removed in 142; `(≥136)` / `(≥142)` = added in that version.

## Element kinds

Attributes attach to one of: **component** (the `<my_widget ...>` def), **state** (`<active ...>`),
**image** (an `<image>` inside `<imagemetrics>`), **component_image** (`<component_image ...>`),
**layoutEngine** (`<LayoutEngine ...>`), **model** (v142 3D family).

## Component attributes

- **Identity**: `id`, `this` (GUID), `uniqueguid`, `uniqueguid_in_template` (≥142), `name`.
- **Layout/position**: `offset` (`"x,y"`, top-left relative to parent — already bakes docking/anchor),
  `docking`, `dock_point`, `dock_offset` (stale editor cache — generally don't author/apply it),
  `component_anchor_point` (`"0.50,0.50"`), `dimensions`, `allowhorizontalresize`, `allowverticalresize`,
  `isaspectratiolocked` (≤136), `aspect_ratio_locked_behaviour` (≥142), `isrelativeresize`.
- **Behaviour/visibility**: `visible`, `is_visible`, `interactive`, `disabled`, `clipchildren`, `moveable`,
  `updatewhennotvisible`, `clipimagestocomponent`, `useglobalclicks`, `renderifroot`, `create_ingame` (≥142),
  `pixelcollision`.
- **State refs / order**: `currentstate`, `defaultstate` (GUIDs → a state), `priority` (z-order).
- **Sound**: `soundcategory` (e.g. `UI_GBL_TMP_Round_Medium_Button`).
- **Tooltip**: `tooltip`, `tooltiplabel`, `tooltipslocalised` / `tooltips_localised`, `componentleveltooltip`
  (`"{{tt:<layout path>}}"`). See `05-tooltips.md` — these are subtle.
- **Template**: `template_id`, `part_of_template`, `dimensions` (instance size override).
- **Editor-only / misc**: `comment`, `locked`, `marked_for_deletion`, `renderlastonfocused` (≤136),
  `is_dev_only` (≥136), `component_level_text` (≥142).

## State attributes

- `this`/`uniqueguid`, `name` (e.g. `active`, `hover`, `down`, `inactive`, `selected`, `purchased`, …).
- Size: `width`, `height`.
- `interactive`, `disabled` (a disabled state = not clickable), `soundcategory` override.
- Text: `text`, `textvalign`, `texthalign`, `texthbehaviour`, `textlabel`, `textlocalised`, `textxoffset`,
  `textyoffset`, fonts `font_m_font_name`, `font_m_size`, `font_m_colour` (`#RRGGBBAA`), `font_m_leading`,
  `font_m_tracking` (≤136), `fontcat_name`, `font_colour_override_preset_key` (≥136),
  `text_shader_name`, `textshadervars`.
- Editor: `stateeditordisplaypos` (UIEd canvas position — harmless to keep/omit).
- Children: `<imagemetrics>` (which images to draw) and optional `<transitionmap>` (state transitions).

## Image (`<image>` inside `<imagemetrics>`)

References a `component_image` and overrides how it's drawn in this state:
`componentimage` (GUID), `width`, `height`, `colour` (`#RRGGBBAA`), `dockpoint` (note: no underscore — e.g.
`Center`, `Bottom Right`), `offset`, `dock_offset`, `tile`, `margin` (9-slice, `"l,t,r,b"`), `shader_name`,
`shadertechnique_vars`, `rotation_angle`, `rotation_axis`, `pivot_point`, `x_flipped`, `y_flipped`,
`canresizewidth`, `canresizeheight`, `ui_colour_preset_type_key`. May optionally carry its own
`this`/`uniqueguid` (the round-button states omit them; some templates include them — both are valid).

## component_image (`<component_image>`)

`this`/`uniqueguid`, `imagepath` (a `.png` path relative to the data root, e.g.
`ui/skins/default/button_round_frame_50.png`), `width`, `height`, `canuse1bitalpha` (≤136). The
**default/dynamic image index** is selected by the `dynamic_image` userproperty (image index 0 in the
round-button templates) — that's the slot a `ContextImageSetter` replaces at runtime.

## LayoutEngine (`<LayoutEngine>`)

`type` (`List` | `HorizontalList` | `RadialList`), `spacing` (`"x,y"`), `margins`, `secondary_margins`,
`sizetocontent`, `horizontal_alignment` (`Center` | `Right`), `vertical_alignment` (`Center` | `Bottom`),
`reverse_order`, `itemsperrow`, `max_length`, `allow_overlap`, `starting_angle`, `radius`, `clockwise`,
`is_listview_lookup_enabled`, `min_dimensions`, `arc` (≥136), `matchfontsizes` (≤136),
`allow_scale_items_down` (≥136), `autocalc_rows` (≥136), and ≥142: `resize_children`, `even_distribution`,
`central_alignment`, `is_using_variable_line_length`, `equal_spacing_size`. Children of a LayoutEngine are
positioned by the engine cursor — their own `offset` is an editor cache and is NOT a nudge (see `07-gotchas.md`).
A LayoutEngine often pairs with a single template child that a `List`/`ContextList` callback repeats.

## Model family (≥142 only)

`component_model_view` → `model_list` → `ComponentModel` → `animation_paths`/`path`, with
`environment_filepath`, `ambient_light_m_ambient_cube_*` (6 faces), `directional_light_m_light_*`,
`camera_target`, `camera_dist`, `camera_fov`, `camera_theta`, `camera_phi`, `num_models`, `filepath`,
`num_anims`, `skeleton_type`, `current_animation_name`, `render_when_not_animating`, `bone_dock_point`,
`dock_bone`, `atlas_path`, `json_path`. Not used in 3K (136).

## Enum value reference

- **Docking** (`docking`, `dock_point`): `None`, `Top Left`, `Top Center`, `Top Right`, `Center Left`,
  `Center`, `Center Right`, `Bottom Left`, `Bottom Center`, `Bottom Right`, plus External variants.
  (Image `dockpoint` uses the same values — note: spelled without underscore.)
- **Text align**: h = `Left`/`Center`/`Right`; v = `Top`/`Center`/`Bottom`.
- **Text h-behaviour**: `Never split`, `Split by word`, `Split by character`, `Resize`.
- **Moveable**: `Immovable`, `Movable XP`, `Movable Win7`.
- **LayoutEngine type**: `List`, `HorizontalList`, `RadialList`.
- **Aspect ratio locked behaviour** (≥142): `Width First`, `Biggest`, `Smallest`, `Only Width`.
- **Text clip behaviour** (≥142): `none`, `ellipsis`, `marquee_on_inspect`, `shrink_then_ellipsis_no_tooltip`.
- **Shader names** (`shader_name`, `text_shader_name`): `normal_t0`, `brighten_t0`, `set_greyscale_t0`,
  `overlay_t0`, `glow_pulse_t0`, `text_bold_t0`, `text_outline_t0`, `drop_shadow_t0`, `colour_replace_t0`,
  `red_pulse_t0`, `border_alpha_blend`, `smoke_overlay_t0`, `pie_chart_t0`, `unitcard_sinking_t0`,
  `multiply`, `distortion`.
- **Colours** are `#RRGGBBAA` (e.g. `#FFFFFFFF` opaque white, `#00000000` transparent, `#818181FF` grey).
