// Helpers over the content-defined CCO shorthand macros (`ui/cco/*.json`, loaded
// by the Rust `load_cco_shorthand` command). Used to annotate Inspector bindings
// with the macro a funcId references and its expansion. The evaluation of these
// macros lives in `cco.ts`; this module is display-only.

import { CcoShorthand, ShorthandDef } from "../types/twui";
import { funcTokens } from "./cco_docs";

/** Resolve a shorthand macro by name — prefer the given object's table, else any. */
export function shorthandDef(
  name: string,
  sh: CcoShorthand | null,
  objectId?: string
): { def: ShorthandDef; ccoType: string } | undefined {
  if (!sh) return undefined;
  if (objectId) {
    const d = sh.objects[objectId.toLowerCase()]?.[name];
    if (d) return { def: d, ccoType: objectId };
  }
  for (const [key, table] of Object.entries(sh.objects)) {
    if (table[name]) return { def: table[name], ccoType: key };
  }
  return undefined;
}

/** A short, single-line summary of a macro's body for display. */
export function shorthandExpansion(def: ShorthandDef): string {
  if (def.ret != null) return def.ret;
  if (def.select.length) {
    return def.select
      .map((c) => (c.cond == null ? `else ${c.ret}` : `${c.cond} -> ${c.ret}`))
      .join("; ");
  }
  return "";
}

/** The first shorthand macro referenced in a binding funcId (for an Inspector hint). */
export function shorthandHint(
  funcId: string,
  objectId: string | undefined,
  sh: CcoShorthand | null
): { name: string; ccoType: string; expansion: string } | undefined {
  if (!sh) return undefined;
  for (const t of funcTokens(funcId)) {
    const found = shorthandDef(t, sh, objectId);
    if (found) return { name: t, ccoType: found.ccoType, expansion: shorthandExpansion(found.def) };
  }
  return undefined;
}
