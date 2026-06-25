// Declarative TWUI attribute schema. The engine's component/state/image attribute
// vocabulary is finite and known, so this is a static table (no backend) describing
// each attribute's kind, control type, enum values, default, category, and a human
// description. The Inspector renders generically from it (labels, tooltips, enum
// dropdowns, colour swatches, defaults, validation, "add known attribute").
//
// Pattern borrowed from chadvandy/TwuiEditor's `TwuiPropertyAttribute` (node + Name +
// Description + Required), adapted to a TS data table. Unknown attributes are NOT
// constrained here — they stay fully editable via the raw element tree / Raw tab, so
// nothing is hidden or lost (our round-trip keeps the verbatim attrs regardless).

export type AttrKind = "component" | "state" | "image" | "component_image" | "layoutEngine" | "model";
export type AttrType = "text" | "number" | "vec2" | "enum" | "bool" | "colour" | "path";

export interface AttrSchema {
  name: string;
  label: string;
  description: string;
  type: AttrType;
  appliesTo: AttrKind[];
  category: string;
  enumValues?: string[];
  default?: string;
  /** Editor-only / rarely-edited cruft — sinks to the bottom of its section when present. */
  priorityHint?: "low";
  /** Inclusive layout-format version range the attribute is valid in. Absent = all versions.
   *  Derived from the bundled 3K (135/136) and WH3 (142) files, so it is an approximation —
   *  gating built on it stays advisory (never hides a present attr, never blocks a commit). */
  versions?: { min?: number; max?: number };
}

/** Whether an attribute is valid in a given layout version. `version` 0 (unknown) allows all,
 *  and an attr with no `versions` range is valid everywhere. */
export function attrInVersion(s: AttrSchema, version: number): boolean {
  if (!version || !s.versions) return true;
  const { min, max } = s.versions;
  return (min === undefined || version >= min) && (max === undefined || version <= max);
}

// --- Shared enum value sets (observed across games/3K/ui/**) ------------------------

export const DOCKING_VALUES = [
  "None",
  "Top Left",
  "Top Center",
  "Top Right",
  "Center Left",
  "Center",
  "Center Right",
  "Bottom Left",
  "Bottom Center",
  "Bottom Right",
  "Top Left External",
  "Top Center External",
  "Top Right External",
  "Center Left External",
  "Center External",
  "Center Right External",
  "Bottom Left External",
  "Bottom Center External",
  "Bottom Right External",
];

export const TEXT_ALIGN = ["Left", "Center", "Right", "Top", "Bottom"];

export const TEXT_HBEHAVIOUR = ["Never split", "Split by word", "Split by character", "Resize"];

export const MOVEABLE = ["Immovable", "Movable XP", "Movable Win7"];

export const SHADER_NAMES = [
  "normal_t0",
  "brighten_t0",
  "set_greyscale_t0",
  "overlay_t0",
  "glow_pulse_t0",
  "text_bold_t0",
  "text_outline_t0",
  "drop_shadow_t0",
  "colour_replace_t0",
  "red_pulse_t0",
  "border_alpha_blend",
  "smoke_overlay_t0",
  "pie_chart_t0",
  "unitcard_sinking_t0",
  "multiply",
  "distortion",
];

const BOOL = ["true", "false"];

// LayoutEngine enums (observed across games/3K/ui/**).
export const LE_TYPE = ["List", "HorizontalList", "RadialList"];
export const LE_HALIGN = ["Center", "Right"];
export const LE_VALIGN = ["Center", "Bottom"];

// WH3 (v142) enums.
export const ASPECT_RATIO_BEHAVIOUR = ["Width First", "Biggest", "Smallest", "Only Width"];
export const TEXT_CLIP_BEHAVIOUR = ["none", "ellipsis", "marquee_on_inspect", "shrink_then_ellipsis_no_tooltip"];

// --- The schema --------------------------------------------------------------------

const C: AttrKind[] = ["component"];
const S: AttrKind[] = ["state"];
const I: AttrKind[] = ["image"];
const CI: AttrKind[] = ["component_image"];
const LE: AttrKind[] = ["layoutEngine"];
const M: AttrKind[] = ["model"];

// Shared by several kinds: GUID identity attrs (engine writes both `this` and `uniqueguid`
// on most elements; templated instances also carry `uniqueguid_in_template`).
const GUID_T: AttrType = "text";

const SCHEMA_LIST: AttrSchema[] = [
  // Layout / component
  { name: "id", label: "id", type: "text", appliesTo: ["component", "model"], category: "Identity",
    description: "The component's identifier (referenced by callbacks via self.Id and by ComponentCreator). On a ComponentModel it names the model (e.g. battle_model_primary)." },
  { name: "offset", label: "offset (x,y)", type: "vec2", appliesTo: ["component", "image"], category: "Layout", default: "0.00,0.00",
    description: "Top-left position relative to the parent (already bakes in docking for regular components)." },
  { name: "docking", label: "docking", type: "enum", enumValues: DOCKING_VALUES, appliesTo: C, category: "Layout", default: "None",
    description: "Anchor edge/corner of the parent the component docks to. 'External' variants dock just outside that edge." },
  { name: "dock_point", label: "dock point", type: "enum", enumValues: DOCKING_VALUES, appliesTo: C, category: "Layout", default: "None",
    description: "Docking used by templated instances (part_of_template); offset is a nudge from this anchor." },
  { name: "dock_offset", label: "dock offset (x,y)", type: "vec2", appliesTo: ["component", "image"], category: "Layout", default: "0.00,0.00",
    description: "Editor-cached offset from the dock point. Unreliable for regular components — the engine never applies it." },
  { name: "component_anchor_point", label: "anchor (0-1)", type: "vec2", appliesTo: C, category: "Layout", default: "0.00,0.00",
    description: "The component's own anchor as fractions (0-1); 0.5,0.5 = centre. Combined with docking to place the rect." },
  { name: "dimensions", label: "dimensions (w,h)", type: "vec2", appliesTo: C, category: "Layout", default: "0.00,0.00",
    description: "Size of a templated instance (part_of_template), since its real states live in the template file." },
  { name: "priority", label: "priority", type: "number", appliesTo: C, category: "Layout", default: "0",
    description: "Render/Z order among siblings — higher draws on top." },
  { name: "visible", label: "visible", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", default: "true",
    description: "Static visibility. Script ContextVisibilitySetter callbacks can override this at runtime." },
  { name: "interactive", label: "interactive", type: "bool", enumValues: BOOL, appliesTo: ["component", "state"], category: "Behaviour", default: "true",
    description: "Whether the component receives mouse input (clicks/hover)." },
  { name: "disabled", label: "disabled", type: "bool", enumValues: BOOL, appliesTo: ["component", "state"], category: "Behaviour", default: "false",
    description: "Disabled (greyed/non-interactive) state." },
  { name: "clipchildren", label: "clip children", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", default: "false",
    description: "Clip descendants to this component's rect — makes it a scrollable viewport when content overflows." },
  { name: "moveable", label: "moveable", type: "enum", enumValues: MOVEABLE, appliesTo: C, category: "Behaviour", default: "Immovable",
    description: "Window drag behaviour (e.g. a draggable slider handle)." },
  { name: "template_id", label: "template id", type: "text", appliesTo: C, category: "Template",
    description: "The template this instance instantiates (its visuals live in ui/templates/<id>.twui.xml)." },
  { name: "part_of_template", label: "part of template", type: "bool", enumValues: BOOL, appliesTo: C, category: "Template", default: "false",
    description: "Marks a templated instance child; its states/images are guid-references into the ancestor template." },
  { name: "currentstate", label: "current state", type: "text", appliesTo: C, category: "State",
    description: "GUID of the state currently rendered (else defaultstate, else the first state)." },
  { name: "defaultstate", label: "default state", type: "text", appliesTo: C, category: "State",
    description: "GUID of the state rendered when no current state is set." },
  { name: "sound_category", label: "sound category", type: "text", appliesTo: C, category: "Behaviour",
    description: "Interaction sound bank key (e.g. UI_GBL_TMP_Square_Large_Text_Button)." },

  // State
  { name: "width", label: "width", type: "number", appliesTo: ["state", "image", "component_image"], category: "Size",
    description: "Width in pixels for this state / image." },
  { name: "height", label: "height", type: "number", appliesTo: ["state", "image", "component_image"], category: "Size",
    description: "Height in pixels for this state / image." },
  { name: "text", label: "text", type: "text", appliesTo: S, category: "Text",
    description: "Static display text for this state (a ContextTextLabel callback can override it)." },
  { name: "textvalign", label: "v-align", type: "enum", enumValues: TEXT_ALIGN, appliesTo: S, category: "Text", default: "Center",
    description: "Vertical alignment of the text within the rect." },
  { name: "texthalign", label: "h-align", type: "enum", enumValues: TEXT_ALIGN, appliesTo: S, category: "Text", default: "Left",
    description: "Horizontal alignment of the text within the rect." },
  { name: "texthbehaviour", label: "h-behaviour", type: "enum", enumValues: TEXT_HBEHAVIOUR, appliesTo: S, category: "Text",
    description: "How over-long text wraps/splits or resizes." },
  { name: "font_m_font_name", label: "font", type: "text", appliesTo: S, category: "Text",
    description: "Font family name (e.g. Iskra-Bold)." },
  { name: "font_m_size", label: "font size", type: "number", appliesTo: S, category: "Text",
    description: "Font size in points." },
  { name: "font_m_colour", label: "font colour", type: "colour", appliesTo: S, category: "Text", default: "#FFFFFFFF",
    description: "Font colour as ARGB hex8 (#AARRGGBB)." },
  { name: "fontcat_name", label: "font preset", type: "text", appliesTo: S, category: "Text",
    description: "Named font category preset (e.g. item_header)." },
  { name: "colour", label: "tint colour", type: "colour", appliesTo: ["state", "image"], category: "Style", default: "#FFFFFFFF",
    description: "Tint applied to the state / image as ARGB hex8 (#AARRGGBB)." },
  { name: "shader_name", label: "shader", type: "enum", enumValues: SHADER_NAMES, appliesTo: ["state", "image"], category: "Style", default: "normal_t0",
    description: "Material/shader used to render (greyscale, glow, outline, etc.)." },

  // Image
  { name: "dockpoint", label: "dock point", type: "enum", enumValues: DOCKING_VALUES, appliesTo: I, category: "Image", default: "Top Left",
    description: "Where this image sits within the component rect." },
  { name: "tile", label: "tile", type: "bool", enumValues: BOOL, appliesTo: I, category: "Image", default: "false",
    description: "Repeat (tile) the texture across the image rect instead of stretching." },
  { name: "canresizewidth", label: "resize width", type: "bool", enumValues: BOOL, appliesTo: I, category: "Image", default: "true",
    description: "Allow the image width to resize with the component." },
  { name: "canresizeheight", label: "resize height", type: "bool", enumValues: BOOL, appliesTo: I, category: "Image", default: "true",
    description: "Allow the image height to resize with the component." },

  // LayoutEngine (the <LayoutEngine> child that arranges a container's children).
  { name: "type", label: "type", type: "enum", enumValues: LE_TYPE, appliesTo: LE, category: "Layout Engine", default: "List",
    description: "List (vertical stack), HorizontalList (horizontal stack), or RadialList (circular). Honoured by the renderer." },
  { name: "spacing", label: "spacing (x,y)", type: "vec2", appliesTo: LE, category: "Layout Engine", default: "0.00,0.00",
    description: "Gap between children: x between columns, y between rows. For a RadialList it is a single value: the per-item angular step in radians. Honoured by the renderer." },
  { name: "margins", label: "margins (x,y)", type: "vec2", appliesTo: LE, category: "Layout Engine", default: "0.00,0.00",
    description: "Inset of the content from the container's edges. Honoured by the renderer." },
  { name: "sizetocontent", label: "size to content", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", default: "true",
    description: "Container shrinks to fit its laid-out children rather than its state size. Honoured by the renderer." },
  { name: "horizontal_alignment", label: "h-alignment", type: "enum", enumValues: LE_HALIGN, appliesTo: LE, category: "Layout Engine",
    description: "How a vertical List centres/right-aligns its rows (default left). Honoured by the renderer." },
  { name: "vertical_alignment", label: "v-alignment", type: "enum", enumValues: LE_VALIGN, appliesTo: LE, category: "Layout Engine",
    description: "How a HorizontalList centres/bottom-aligns its items (default top). Honoured by the renderer." },
  { name: "reverse_order", label: "reverse order", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", default: "true",
    description: "Lay children out in reverse. Honoured by the renderer." },
  { name: "itemsperrow", label: "items per row", type: "number", appliesTo: LE, category: "Layout Engine",
    description: "Grid: number of items per row before wrapping (vertical List). Honoured by the renderer." },
  { name: "secondary_margins", label: "secondary margins (x,y)", type: "vec2", appliesTo: LE, category: "Layout Engine",
    description: "Per-row cross-axis margins (game only; not used by the editor renderer)." },
  { name: "max_length", label: "max length", type: "number", appliesTo: LE, category: "Layout Engine",
    description: "Maximum length of the list before clipping/overlap (game only; not used by the editor renderer)." },
  { name: "allow_overlap", label: "allow overlap", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", default: "true",
    description: "Let children overlap when they exceed max_length (game only; not used by the editor renderer)." },
  { name: "starting_angle", label: "starting angle", type: "number", appliesTo: LE, category: "Layout Engine",
    description: "RadialList: angle (radians) of the first item (0 = east/right). Honoured by the renderer." },
  { name: "arc", label: "arc", type: "number", appliesTo: LE, category: "Layout Engine", versions: { min: 136 },
    description: "RadialList: total arc (radians); 0 = full circle (added in 136; not yet applied by the renderer; spacing drives placement)." },
  { name: "radius", label: "radius", type: "number", appliesTo: LE, category: "Layout Engine",
    description: "RadialList: radius in pixels from the container centre. Honoured by the renderer." },
  { name: "clockwise", label: "clockwise", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", default: "true",
    description: "RadialList: lay items out clockwise. Honoured by the renderer." },
  { name: "is_listview_lookup_enabled", label: "listview lookup", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine",
    description: "Enable list-view lookup acceleration for the laid-out children (game only)." },
  { name: "min_dimensions", label: "min dimensions (w,h)", type: "vec2", appliesTo: LE, category: "Layout Engine",
    description: "Minimum size the container is allowed to shrink to under size-to-content (game only)." },
  { name: "matchfontsizes", label: "match font sizes", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { max: 136 },
    description: "Normalise the font sizes of laid-out text children to match (game only; 3K — removed in WH3/142)." },
  { name: "allow_scale_items_down", label: "scale items down", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { min: 136 },
    description: "Allow children to be scaled down to fit when they overflow (game only; added in 136)." },
  { name: "autocalc_rows", label: "auto-calc rows", type: "text", appliesTo: LE, category: "Layout Engine", versions: { min: 136 },
    description: "Automatically compute the number of rows from the item count (game only; added in 136)." },
  // LayoutEngine — WH3 (v142) engine attrs.
  { name: "resize_children", label: "resize children", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { min: 142 },
    description: "Resize children to the container's cross-axis extent (game only; WH3/142)." },
  { name: "even_distribution", label: "even distribution", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { min: 142 },
    description: "Distribute children evenly across the available length (game only; WH3/142)." },
  { name: "central_alignment", label: "central alignment", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { min: 142 },
    description: "Centre the laid-out block within the container (game only; WH3/142)." },
  { name: "is_using_variable_line_length", label: "variable line length", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { min: 142 },
    description: "Allow rows of differing length when wrapping (game only; WH3/142)." },
  { name: "equal_spacing_size", label: "equal spacing size", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", versions: { min: 142 },
    description: "Force equal spacing slots regardless of child size (game only; WH3/142)." },

  // --- Identity / GUID (shared across element kinds) ---------------------------------
  { name: "this", label: "guid (this)", type: GUID_T, appliesTo: ["component", "state", "image", "component_image"], category: "Identity",
    description: "This element's GUID. Editing it breaks any currentstate/defaultstate/componentimage references that point here — use the GUIDs section to regenerate safely." },
  { name: "uniqueguid", label: "unique guid", type: GUID_T, appliesTo: ["component", "state", "image", "component_image"], category: "Identity",
    description: "The element's unique GUID (mirrors `this`). Same editing caveat as `this`." },
  { name: "uniqueguid_in_template", label: "template guid", type: GUID_T, appliesTo: C, category: "Identity", versions: { min: 142 },
    description: "GUID this templated instance maps to inside its template file (WH3/142)." },
  { name: "name", label: "name", type: "text", appliesTo: S, category: "Identity",
    description: "The state's name (active, hover, selected, NewState, ...). Referenced by the preview-state selector." },

  // --- Component additions ----------------------------------------------------------
  { name: "tooltipslocalised", label: "tooltips localised", type: "bool", enumValues: BOOL, appliesTo: C, category: "Tooltip",
    description: "Treat tooltip text as a localisation key rather than literal text." },
  { name: "tooltips_localised", label: "tooltips localised", type: "bool", enumValues: BOOL, appliesTo: C, category: "Tooltip",
    description: "Treat tooltip text as a localisation key (newer underscore spelling)." },
  { name: "tooltiplabel", label: "tooltip label", type: "text", appliesTo: ["component", "state"], category: "Tooltip",
    description: "Localisation key for the tooltip text." },
  { name: "componentleveltooltip", label: "component tooltip", type: "text", appliesTo: C, category: "Tooltip",
    description: "A component-level tooltip reference, e.g. {{tt:ui/common ui/tooltip_x}}." },
  { name: "allowhorizontalresize", label: "allow h-resize", type: "bool", enumValues: BOOL, appliesTo: C, category: "Layout",
    description: "Allow this component's width to be resized by the layout/engine." },
  { name: "allowverticalresize", label: "allow v-resize", type: "bool", enumValues: BOOL, appliesTo: C, category: "Layout",
    description: "Allow this component's height to be resized by the layout/engine." },
  { name: "isaspectratiolocked", label: "aspect locked", type: "bool", enumValues: BOOL, appliesTo: ["component", "image"], category: "Layout", versions: { max: 136 },
    description: "Lock the aspect ratio when the element is resized (3K). Replaced in WH3/142 by the enum aspect_ratio_locked_behaviour." },
  { name: "isrelativeresize", label: "relative resize", type: "bool", enumValues: BOOL, appliesTo: ["component", "image"], category: "Layout",
    description: "Resize relative to the parent rather than to an absolute size." },
  { name: "aspect_ratio_locked_behaviour", label: "aspect behaviour", type: "enum", enumValues: ASPECT_RATIO_BEHAVIOUR, appliesTo: ["component", "image"], category: "Layout", versions: { min: 142 },
    description: "How aspect-ratio locking is applied when resizing (WH3/142). Replaces the older isaspectratiolocked bool." },
  { name: "is_visible", label: "is visible", type: "bool", enumValues: BOOL, appliesTo: ["component", "model"], category: "Behaviour", default: "true",
    description: "Static visibility (newer flag; engine also honours the older `visible`). On a ComponentModel toggles that model's rendering." },
  { name: "soundcategory", label: "sound category", type: "text", appliesTo: ["component", "state"], category: "Behaviour",
    description: "Interaction sound bank key (engine variant of `sound_category`, no underscore)." },
  { name: "updatewhennotvisible", label: "update when hidden", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", default: "false",
    description: "Keep updating this component's bindings even while it is not visible." },
  { name: "clipimagestocomponent", label: "clip images", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", default: "false",
    description: "Clip the component's images to its own rect." },
  { name: "renderwhendragged", label: "render when dragged", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", default: "false", versions: { max: 136 },
    description: "Keep rendering the component while it is being dragged (3K — removed in WH3/142)." },
  { name: "useglobalclicks", label: "use global clicks", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", default: "false",
    description: "Receive global click events even when not directly hit-tested." },
  { name: "renderifroot", label: "render if root", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour",
    description: "Render this component when it is the root of the layout." },
  { name: "maskimage", label: "mask image", type: "text", appliesTo: C, category: "Style",
    description: "GUID of a component image used as an alpha mask for this component." },
  { name: "fontscale", label: "font scale", type: "number", appliesTo: C, category: "Text",
    description: "Multiplier applied to this component's font sizes." },
  { name: "layouttransition", label: "layout transition", type: "text", appliesTo: C, category: "Behaviour",
    description: "Named layout transition to play (engine spelling without underscore)." },
  { name: "layout_transition", label: "layout transition", type: "text", appliesTo: C, category: "Behaviour",
    description: "Named layout transition to play (underscore spelling)." },
  { name: "create_ingame", label: "create in-game", type: "bool", enumValues: BOOL, appliesTo: C, category: "Behaviour", versions: { min: 142 },
    description: "Whether the component is created at runtime in-game (WH3/142)." },
  { name: "text_label", label: "text label", type: "text", appliesTo: C, category: "Text",
    description: "Component-level localisation key for text (WH3)." },
  { name: "component_level_text", label: "component text", type: "text", appliesTo: C, category: "Text", versions: { min: 142 },
    description: "Component-level static/override text (WH3/142)." },
  { name: "text_clip_behaviour", label: "text clip", type: "enum", enumValues: TEXT_CLIP_BEHAVIOUR, appliesTo: ["component", "state"], category: "Text", versions: { min: 142 },
    description: "How over-long text is clipped (WH3/142): none, ellipsis, marquee_on_inspect, or shrink_then_ellipsis_no_tooltip." },
  { name: "comment", label: "comment", type: "text", appliesTo: C, category: "Editor", priorityHint: "low",
    description: "Author comment kept in the file; no runtime effect." },
  { name: "locked", label: "locked", type: "bool", enumValues: BOOL, appliesTo: C, category: "Editor", priorityHint: "low",
    description: "Editor-only: locked against selection/editing in the original tool." },
  { name: "marked_for_deletion", label: "marked for deletion", type: "bool", enumValues: BOOL, appliesTo: C, category: "Editor", priorityHint: "low",
    description: "Editor-only flag from the original tool; no runtime effect." },
  { name: "renderlastonfocused", label: "render last on focus", type: "bool", enumValues: BOOL, appliesTo: C, category: "Editor", priorityHint: "low", versions: { max: 136 },
    description: "Render this component last (on top) when focused (3K — removed in WH3/142)." },
  { name: "is_dev_only", label: "dev only", type: "bool", enumValues: BOOL, appliesTo: C, category: "Editor", priorityHint: "low", versions: { min: 136 },
    description: "Component exists only in dev builds (added in 136)." },

  // --- State additions --------------------------------------------------------------
  { name: "textlabel", label: "text label", type: "text", appliesTo: S, category: "Text",
    description: "Localisation key for this state's text (used when textlocalised)." },
  { name: "textlocalised", label: "text localised", type: "bool", enumValues: BOOL, appliesTo: S, category: "Text",
    description: "Treat the text as a localisation key (textlabel) rather than literal." },
  { name: "textxoffset", label: "text x-offset", type: "number", appliesTo: S, category: "Text",
    description: "Horizontal pixel offset applied to the text within the rect." },
  { name: "textyoffset", label: "text y-offset", type: "number", appliesTo: S, category: "Text",
    description: "Vertical pixel offset applied to the text within the rect." },
  { name: "font_m_leading", label: "font leading", type: "number", appliesTo: S, category: "Text",
    description: "Line leading (line-height) for multi-line text." },
  { name: "font_m_tracking", label: "font tracking", type: "number", appliesTo: S, category: "Text", versions: { max: 136 },
    description: "Letter tracking (spacing between glyphs) (3K — removed in WH3/142)." },
  { name: "font_colour_override_preset_key", label: "font colour preset", type: "text", appliesTo: S, category: "Text", versions: { min: 136 },
    description: "Named colour preset overriding the font colour (e.g. green, red) (added in 136)." },
  { name: "shadervars", label: "shader vars", type: "text", appliesTo: S, category: "Style",
    description: "Comma-separated parameters for the state's shader (e.g. 1.00,0.50,0.00,0.00)." },
  { name: "textshadervars", label: "text shader vars", type: "text", appliesTo: S, category: "Style",
    description: "Comma-separated parameters for the text shader." },
  { name: "text_shader_name", label: "text shader", type: "enum", enumValues: SHADER_NAMES, appliesTo: S, category: "Style",
    description: "Shader/material used to render this state's text." },
  { name: "material_name", label: "material", type: "text", appliesTo: ["state", "image"], category: "Style",
    description: "Named material override for rendering." },
  { name: "tooltip", label: "tooltip", type: "text", appliesTo: S, category: "Tooltip",
    description: "Literal tooltip text (or a key when tooltips are localised)." },
  { name: "pixelcollision", label: "pixel collision", type: "bool", enumValues: BOOL, appliesTo: S, category: "Behaviour",
    description: "Hit-test against opaque pixels rather than the bounding rect." },
  { name: "focustype", label: "focus type", type: "text", appliesTo: S, category: "Behaviour",
    description: "Keyboard/gamepad focus behaviour for this state." },
  { name: "imagedock9patch", label: "9-patch dock", type: "text", appliesTo: S, category: "Image",
    description: "9-patch docking configuration for the state's images." },
  { name: "blockedanims", label: "blocked anims", type: "text", appliesTo: S, category: "Behaviour",
    description: "Animations blocked while in this state." },
  { name: "stateeditordisplaypos", label: "editor pos (x,y)", type: "vec2", appliesTo: S, category: "Editor", priorityHint: "low",
    description: "Editor-only: where this state's node sits in the original state-graph editor. No runtime effect." },

  // --- Image (imagemetrics <image>) additions ---------------------------------------
  { name: "componentimage", label: "component image", type: GUID_T, appliesTo: I, category: "Image",
    description: "GUID of the <component_image> this metric draws. Editing it relinks which texture is shown." },
  { name: "margin", label: "margin (l,t,r,b)", type: "text", appliesTo: I, category: "Image",
    description: "Per-edge margins (left,top,right,bottom) — four comma-separated values." },
  { name: "ui_colour_preset_type_key", label: "colour preset", type: "text", appliesTo: I, category: "Style",
    description: "Named colour preset applied to the image (e.g. green, red, orange)." },
  { name: "shadertechnique_vars", label: "shader tech vars", type: "text", appliesTo: I, category: "Style",
    description: "Comma-separated parameters for the image's shader technique." },
  { name: "rotation_angle", label: "rotation angle", type: "number", appliesTo: I, category: "Image",
    description: "Rotation of the image in degrees/radians about its pivot." },
  { name: "rotation_axis", label: "rotation axis", type: "text", appliesTo: I, category: "Image",
    description: "Axis the image rotates about." },
  { name: "pivot_point", label: "pivot point", type: "text", appliesTo: I, category: "Image",
    description: "Pivot used for rotation/scale." },
  { name: "x_flipped", label: "flip X", type: "bool", enumValues: BOOL, appliesTo: I, category: "Image", default: "false",
    description: "Mirror the image horizontally." },
  { name: "y_flipped", label: "flip Y", type: "bool", enumValues: BOOL, appliesTo: I, category: "Image", default: "false",
    description: "Mirror the image vertically." },

  // --- Component image (<componentimages><component_image>) --------------------------
  { name: "imagepath", label: "image path", type: "path", appliesTo: CI, category: "Image",
    description: "Texture path (relative to the data root), e.g. ui/skins/default/foo.png." },
  { name: "canuse1bitalpha", label: "1-bit alpha", type: "bool", enumValues: BOOL, appliesTo: CI, category: "Image", default: "false", versions: { max: 136 },
    description: "Allow the texture to use 1-bit alpha (cheaper, no blending) (3K — removed in WH3/142)." },

  // --- 3D model view (WH3/142: <component_model_view> and its <model_list><ComponentModel>) ---
  // Schema labels only — the nested <animation_paths>/<path> list stays Raw-editable.
  { name: "environment_filepath", label: "environment", type: "path", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Lighting/environment file for the model view (e.g. Porthole/advisor/default_porthole.lighting)." },
  { name: "ambient_light_m_ambient_cube_front", label: "ambient front", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Ambient cube light colour facing front (r,g,b)." },
  { name: "ambient_light_m_ambient_cube_back", label: "ambient back", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Ambient cube light colour facing back (r,g,b)." },
  { name: "ambient_light_m_ambient_cube_top", label: "ambient top", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Ambient cube light colour facing up (r,g,b)." },
  { name: "ambient_light_m_ambient_cube_bottom", label: "ambient bottom", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Ambient cube light colour facing down (r,g,b)." },
  { name: "ambient_light_m_ambient_cube_left", label: "ambient left", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Ambient cube light colour facing left (r,g,b)." },
  { name: "ambient_light_m_ambient_cube_right", label: "ambient right", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Ambient cube light colour facing right (r,g,b)." },
  { name: "directional_light_m_light_colour", label: "light colour", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Directional light colour (r,g,b)." },
  { name: "directional_light_m_light_direction", label: "light direction", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Directional light direction vector (x,y,z radians/components)." },
  { name: "camera_target", label: "camera target", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Point the camera looks at (x,y,z)." },
  { name: "camera_dist", label: "camera distance", type: "number", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Camera distance from the target." },
  { name: "camera_fov", label: "camera fov", type: "number", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Camera field of view." },
  { name: "camera_theta", label: "camera theta", type: "number", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Camera azimuth angle (radians)." },
  { name: "camera_phi", label: "camera phi", type: "number", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Camera elevation angle (radians)." },
  { name: "num_models", label: "num models", type: "number", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Number of <ComponentModel> entries in the model list." },
  // ComponentModel (a single model within the list).
  { name: "filepath", label: "model file", type: "path", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "VariantMesh definition for the model (e.g. VariantMeshes/.../emp_captains.VariantMeshDefinition)." },
  { name: "num_anims", label: "num anims", type: "number", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Number of <path> animation entries for this model." },
  { name: "skeleton_type", label: "skeleton", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Skeleton the model uses (e.g. humanoid01, horse01)." },
  { name: "current_animation_name", label: "current anim", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Name of the animation currently playing on the model." },
  { name: "render_when_not_animating", label: "render when idle", type: "bool", enumValues: BOOL, appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Keep rendering the model when no animation is playing." },
  { name: "bone_dock_point", label: "bone dock point", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Bone the model docks UI elements to." },
  { name: "dock_bone", label: "dock bone", type: "text", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Bone used as the dock anchor for the model." },
  { name: "atlas_path", label: "atlas path", type: "path", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "Texture atlas path used by the model view." },
  { name: "json_path", label: "json path", type: "path", appliesTo: M, category: "Model", versions: { min: 142 },
    description: "JSON descriptor path used by the model view." },
];

const BY_NAME = new Map<string, AttrSchema[]>();
for (const s of SCHEMA_LIST) {
  const list = BY_NAME.get(s.name) ?? [];
  list.push(s);
  BY_NAME.set(s.name, list);
}

/** The schema for an attribute — prefer one that applies to `kind` (and, when several do,
 *  one that is valid in `version`), else the first applying to `kind`, else the first overall.
 *  Always returns a match when the name is known, even if it is out-of-version, so a present
 *  out-of-version attribute still renders with its label/type. */
export function schemaFor(name: string, kind?: AttrKind, version = 0): AttrSchema | undefined {
  const list = BY_NAME.get(name);
  if (!list) return undefined;
  if (kind) {
    const forKind = list.filter((s) => s.appliesTo.includes(kind));
    if (forKind.length) {
      return forKind.find((s) => attrInVersion(s, version)) ?? forKind[0];
    }
  }
  return list[0];
}

/** All schema entries that apply to a given element kind and are valid in `version` (for the
 *  "add attribute" dropdown). `version` 0 (unknown) includes everything. */
export function attrsFor(kind: AttrKind, version = 0): AttrSchema[] {
  return SCHEMA_LIST.filter((s) => s.appliesTo.includes(kind) && attrInVersion(s, version));
}

/** Advisory validation — returns a human message when the value looks malformed, else
 *  null. Never blocks a commit (the raw tree always keeps whatever the user types). */
export function validateAttr(schema: AttrSchema, value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  switch (schema.type) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v) ? null : "expected a number";
    case "vec2":
      return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v) ? null : 'expected "x,y"';
    case "colour":
      return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? null : "expected #RRGGBB or #AARRGGBB";
    case "bool":
      return v === "true" || v === "false" ? null : 'expected "true" or "false"';
    case "enum":
      return schema.enumValues?.includes(v) ? null : `not a known value (${schema.enumValues?.length ?? 0} options)`;
    default:
      return null;
  }
}
