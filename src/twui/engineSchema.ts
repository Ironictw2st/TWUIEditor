// What the 3K game itself reads, per editor element kind: the engine attribute data
// (engineAttrs.ts, generated from Three_Kingdoms.exe 1.7.2.0) mapped onto the editor's AttrKinds,
// plus how the game parses each value type. schema.ts layers this over its hand-made table for
// 3K layout versions; the engine-unread-attr rule uses it for "never read" notes.

import { ENGINE_ATTRS, type EngineAttr } from "./engineAttrs";
import type { AttrKind } from "./schema";

/** 3K layout versions (WH3 = 142 is a different game build). */
export const ENGINE_VERSIONS = new Set([129, 135, 136]);

/** Engine object kind -> the editor's element kind. */
export const ENGINE_KIND_MAP: Record<string, AttrKind> = {
  component: "component",
  template_link: "component",
  state: "state",
  image: "image",
  component_image: "component_image",
  layoutEngine: "layoutEngine",
  layoutEngine_RadialList: "layoutEngine",
  layoutEngine_Table: "layoutEngine",
  layoutEngine_any: "layoutEngine",
  model: "model",
  transition: "transition",
  animation: "animation",
};

/** Scalar types the game parses itself (lists / child elements are not attribute values). */
const VALUE_TYPES = new Set([
  "bool", "int", "uint", "float", "enum", "vec2", "vec3", "vec4", "colour",
  "string", "pooled_string", "unistring", "guid", "guid_ref",
]);

/** (kind, attr) -> the engine attribute. When two engine readers of one editor kind disagree on
 *  the type (layoutEngine `spacing`: vec2 on lists, float on radial lists) the entry becomes a
 *  union ("vec2|float", no default): a value is accepted when either reader can parse it. */
const BY_KIND = new Map<AttrKind, Map<string, EngineAttr>>();
for (const a of ENGINE_ATTRS) {
  const kind = ENGINE_KIND_MAP[a.kind];
  // `this` is also used to link the hierarchy, outside these readers: claim nothing about it
  if (!kind || !VALUE_TYPES.has(a.type) || a.attr === "this") continue;
  if (!BY_KIND.has(kind)) BY_KIND.set(kind, new Map());
  const m = BY_KIND.get(kind)!;
  const prev = m.get(a.attr);
  if (!prev) m.set(a.attr, a);
  else if (!prev.type.split("|").includes(a.type)) m.set(a.attr, { ...prev, type: `${prev.type}|${a.type}`, default: undefined, offset: null });
  else if (prev.default !== a.default) m.set(a.attr, { ...prev, default: undefined });
}

/** LayoutEngine `type` -> the engine reader of that type's properties. List and HorizontalList
 *  read the same set; RadialList and Table read only their own (FUN_14063e3a0 / FUN_14063ea50). */
const LE_READER: Record<string, string> = {
  List: "layoutEngine",
  HorizontalList: "layoutEngine",
  RadialList: "layoutEngine_RadialList",
  Table: "layoutEngine_Table",
};
const BY_READER = new Map<string, Map<string, EngineAttr>>();
for (const a of ENGINE_ATTRS) {
  if (!a.kind.startsWith("layoutEngine")) continue;
  if (!BY_READER.has(a.kind)) BY_READER.set(a.kind, new Map());
  if (!BY_READER.get(a.kind)!.has(a.attr)) BY_READER.get(a.kind)!.set(a.attr, a);
}

/** The reader of `name` on a LayoutEngine of `type`: undefined when the type is unknown (the
 *  game then builds no layout engine), null when that type never reads the attribute. */
export function layoutEngineAttr(type: string | undefined, name: string): EngineAttr | null | undefined {
  const reader = type ? LE_READER[type] : undefined;
  if (!reader) return undefined;
  return BY_READER.get(reader)?.get(name) ?? BY_READER.get("layoutEngine_any")?.get(name) ?? null;
}

/** Whether the game's reader looks at an attribute in layout `version` (0 = unknown = yes). */
export function engineReadsInVersion(a: EngineAttr, version: number): boolean {
  if (!version || !a.versions) return true;
  const { min, max } = a.versions;
  return (min === undefined || version >= min) && (max === undefined || version <= max);
}

/** "read only from v131" / "read only up to v125" */
export function engineVersionText(a: EngineAttr): string {
  const { min, max } = a.versions ?? {};
  if (min !== undefined && max !== undefined) return `read only in v${min}-v${max}`;
  if (min !== undefined) return `read only from v${min}`;
  return max !== undefined ? `read only up to v${max}` : "read in every version";
}

/** The engine's reader for `name` on an element of `kind`, if the value type is known. */
export function engineAttrFor(kind: AttrKind | undefined, name: string): EngineAttr | undefined {
  return kind ? BY_KIND.get(kind)?.get(name) : undefined;
}

/** Every typed engine attribute of `kind`. */
export function engineAttrsOf(kind: AttrKind): EngineAttr[] {
  return [...(BY_KIND.get(kind)?.values() ?? [])];
}

// std::from_chars syntax (no leading '+', no spaces, no thousands separators).
const FLOAT_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const vecRe = (n: number) => new RegExp(`^${Array(n).fill("\\s*-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?\\s*").join(",")}$`);
const VEC_RE: Record<string, RegExp> = { vec2: vecRe(2), vec3: vecRe(3), vec4: vecRe(4) };

/** How the game will read `value`, as a message when that differs from what the author likely
 *  meant (null = the game reads it as written). Empty values are left alone. */
export function engineValueProblem(a: EngineAttr, value: string): string | null {
  const v = value;
  if (v === "") return null;
  if (a.type.includes("|")) {
    const types = a.type.split("|");
    if (types.some((t) => engineValueProblem({ ...a, type: t }, v) === null)) return null;
    return `the game reads ${a.attr} as ${types.join(" or ")} (depends on the layout engine); "${v}" parses as neither`;
  }
  switch (a.type) {
    case "bool":
      if (v === "true" || v === "false") return null;
      // the reader only tests the first character: 't' = true, anything else = false
      return `the game reads "${v}" as ${v.startsWith("t") ? "true" : "false"} (only a leading lower-case t means true)`;
    case "int":
      return /^-?\d+$/.test(v) ? null : `the game reads ${a.attr} as a whole number; "${v}" does not parse`;
    case "uint":
      if (/^\d+$/.test(v)) return null;
      return /^-\d+$/.test(v)
        ? `the game reads ${a.attr} as an unsigned number; a negative value does not parse`
        : `the game reads ${a.attr} as a whole number >= 0; "${v}" does not parse`;
    case "float":
      return FLOAT_RE.test(v) ? null : `the game cannot parse "${v}" as a number`;
    case "vec2":
    case "vec3":
    case "vec4":
      return VEC_RE[a.type].test(v) ? null : `expected ${a.type.slice(3)} comma-separated numbers`;
    case "enum": {
      const vals = a.values ?? [];
      if (vals.includes(v)) return null;
      const near = vals.find((x) => x.toLowerCase() === v.toLowerCase());
      const what = a.unknown ? `: ${a.unknown}` : ` and uses "${vals[0]}"`;
      return `the game does not know "${v}"${what}` + (near ? ` (names are case-sensitive: "${near}")` : "");
    }
    default:
      return null;
  }
}
