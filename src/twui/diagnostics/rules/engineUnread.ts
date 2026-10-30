// Rule: an attribute the 3K game's own TWUI reader never looks at. The attribute names come
// from the engine's serializers (engineAttrs.ts, extracted from Three_Kingdoms.exe 1.7.2.0),
// so this is what the game really reads, not what the bundled files happen to contain.
// The reader matches names exactly (pugixml, case-sensitive), so a misspelt or editor-only
// attribute is silently ignored in game. Advisory only (info): 3K layout versions only, and
// only for the element kinds the extraction covers.

import { ENGINE_ATTRS } from "../../engineAttrs";
import { ENGINE_VERSIONS } from "../../engineSchema";
import type { AttrKind } from "../../schema";
import type { Diagnostic, Rule } from "../types";

/** Engine object kind -> the editor's element kind. */
const KIND_MAP: Record<string, AttrKind> = {
  component: "component",
  template_link: "component",
  state: "state",
  image: "image",
  component_image: "component_image",
  layoutEngine: "layoutEngine",
  layoutEngine_radial: "layoutEngine",
  layoutEngine_cells: "layoutEngine",
};

/** Read by the game through paths the extractor does not follow yet (verified by the
 *  strings sitting in the engine's TWUI name block, or by structure). */
const ALSO_READ: Partial<Record<AttrKind, string[]>> = {
  component: ["this"],
  state: ["this", "uniqueguid", "shadervars", "shader_name", "textshadervars", "text_shader_name"],
  image: ["this"],
  component_image: ["this"],
  layoutEngine: ["type"],
};

const READ = new Map<AttrKind, Set<string>>();
for (const [kind, names] of Object.entries(ALSO_READ)) READ.set(kind as AttrKind, new Set(names));
for (const a of ENGINE_ATTRS) {
  const kind = KIND_MAP[a.kind];
  if (!kind) continue;
  if (!READ.has(kind)) READ.set(kind, new Set());
  READ.get(kind)!.add(a.attr);
}
/** UIEd's own bookkeeping: the game ignores it, but vanilla files carry it everywhere
 *  (~11k uses in the bundled 3K layouts), so it is not worth a note. */
const EDITOR_METADATA = new Set(["stateeditordisplaypos", "comment", "locked", "marked_for_deletion"]);

/** snake_case names the game reads on components created from a template. */
const TEMPLATE_OVERRIDE = new Set(ENGINE_ATTRS.filter((a) => a.kind === "template_override").map((a) => a.attr));

/** Whether the 3K game reads `name` on an element of `kind` (undefined = kind not covered). */
export function engineReads(kind: AttrKind, name: string, templated = false): boolean | undefined {
  const set = READ.get(kind);
  if (!set) return undefined;
  if (set.has(name)) return true;
  return kind === "component" && templated && TEMPLATE_OVERRIDE.has(name);
}

export const engineUnreadRule: Rule = {
  id: "engine-unread-attr",
  title: "Attribute the game never reads",
  cost: "expensive",
  defaultSeverity: "info",
  run(ctx) {
    if (!ENGINE_VERSIONS.has(ctx.version)) return [];
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      for (const [name] of c.el.attrs) {
        if (EDITOR_METADATA.has(name) || engineReads(c.kind, name, c.templated) !== false) continue;
        out.push({
          ruleId: "engine-unread-attr",
          severity: "info",
          message: `${name} is never read by the 3K game on a ${c.kind} (ignored in game)`,
          guid: c.guid,
          attr: name,
        });
      }
    }
    return out;
  },
};
