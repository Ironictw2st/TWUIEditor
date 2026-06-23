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

export type AttrKind = "component" | "state" | "image" | "layoutEngine";
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

// --- The schema --------------------------------------------------------------------

const C: AttrKind[] = ["component"];
const S: AttrKind[] = ["state"];
const I: AttrKind[] = ["image"];
const LE: AttrKind[] = ["layoutEngine"];

const SCHEMA_LIST: AttrSchema[] = [
  // Layout / component
  { name: "id", label: "id", type: "text", appliesTo: C, category: "Identity",
    description: "The component's identifier (referenced by callbacks via self.Id and by ComponentCreator)." },
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
  { name: "width", label: "width", type: "number", appliesTo: ["state", "image"], category: "Size",
    description: "Width in pixels for this state / image." },
  { name: "height", label: "height", type: "number", appliesTo: ["state", "image"], category: "Size",
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
  { name: "imagepath", label: "image path", type: "path", appliesTo: I, category: "Image",
    description: "Texture path (relative to the data root), e.g. ui/skins/default/foo.png." },
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
    description: "List (vertical stack), HorizontalList (horizontal stack), or RadialList (circular). Honoured by the renderer (RadialList partially)." },
  { name: "spacing", label: "spacing (x,y)", type: "vec2", appliesTo: LE, category: "Layout Engine", default: "0.00,0.00",
    description: "Gap between children: x between columns, y between rows. Honoured by the renderer." },
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
    description: "RadialList: angle (radians) of the first item (game only)." },
  { name: "arc", label: "arc", type: "number", appliesTo: LE, category: "Layout Engine",
    description: "RadialList: total arc (radians); 0 = full circle (game only)." },
  { name: "radius", label: "radius", type: "number", appliesTo: LE, category: "Layout Engine",
    description: "RadialList: radius in pixels (game only)." },
  { name: "clockwise", label: "clockwise", type: "bool", enumValues: BOOL, appliesTo: LE, category: "Layout Engine", default: "true",
    description: "RadialList: lay items out clockwise (game only)." },
];

const BY_NAME = new Map<string, AttrSchema[]>();
for (const s of SCHEMA_LIST) {
  const list = BY_NAME.get(s.name) ?? [];
  list.push(s);
  BY_NAME.set(s.name, list);
}

/** The schema for an attribute — prefer one that applies to `kind`, else the first. */
export function schemaFor(name: string, kind?: AttrKind): AttrSchema | undefined {
  const list = BY_NAME.get(name);
  if (!list) return undefined;
  if (kind) {
    const m = list.find((s) => s.appliesTo.includes(kind));
    if (m) return m;
  }
  return list[0];
}

/** All schema entries that apply to a given element kind (for "add attribute"). */
export function attrsFor(kind: AttrKind): AttrSchema[] {
  return SCHEMA_LIST.filter((s) => s.appliesTo.includes(kind));
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
