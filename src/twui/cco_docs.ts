// Helpers over the CCO symbol table (parsed from the game UI docs by the Rust
// `load_cco_docs` command). Used to annotate Inspector bindings with each CCO
// function's return type + description.

import { CcoDocs, CcoFunc, CcoShorthand } from "../types/twui";

/** Resolve a CCO function definition — prefer the given object's table, else any. */
export function funcDef(name: string, docs: CcoDocs | null, objectId?: string): CcoFunc | undefined {
  if (!docs) return undefined;
  if (objectId) {
    const d = docs.objects[objectId]?.[name];
    if (d) return d;
  }
  for (const fns of Object.values(docs.objects)) {
    if (fns[name]) return fns[name];
  }
  return undefined;
}

// Evaluator / keyword tokens that are NOT CCO record functions.
const ENGINE = new Set([
  "Loc", "ToUpper", "RoundFloat", "YearFormat", "HasValueForKey", "ValueForKey", "Filter",
  "FirstContext", "Size", "GetIf", "GetIfElse", "Format", "IsContextValid", "StringContains",
  "EffectBundleFromKey", "ScriptObjectContext", "Component", "CharactersForCQIs", "TableValue",
  "this", "self", "true", "false", "nil",
  // List/aggregate builtins (evaluated by the engine, not members of any type).
  "Sum", "Join", "Transform", "Min", "Max", "Any", "Contains", "First",
]);

/** Function-name tokens in a binding funcId, in order, minus engine funcs/keywords.
 *  String literals are stripped first so path/key text inside `"…"` isn't mistaken for a function. */
export function funcTokens(funcId: string): string[] {
  const cleaned = funcId.replace(/"[^"]*"/g, " ").replace(/'[^']*'/g, " ");
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /[A-Za-z_][\w]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const t = m[0];
    if (ENGINE.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** How a binding fares against the metadata-verified symbol table.
 *  The asymmetric proof rule (reference/cco-schema-sources.md): only types in
 *  `docs.verified` carry a provable property set — everything else is
 *  "unverifiable", never "undocumented". */
export type BindingStatus = "documented" | "extension" | "undocumented" | "unverifiable";

/** Classify a binding's FIRST non-engine token against its context type. Only the
 *  first token is judged — later tokens may legally resolve on list-element types
 *  inside `Filter(..., IntValue < 0)`-style predicates. Returns undefined when
 *  there is nothing to judge (no docs / no object / constructor / root accessor). */
export function bindingStatus(
  funcId: string,
  objectId: string | undefined,
  docs: CcoDocs | null,
  shorthand: CcoShorthand | null,
): BindingStatus | undefined {
  if (!docs || !objectId || !funcId) return undefined;
  if (!docs.verified?.includes(objectId)) return "unverifiable";
  const t = funcTokens(funcId)[0];
  // Nothing judgeable: pure-literal exprs, CcoRT* tooltip constructors, globals.
  if (!t || t.startsWith("Cco") || docs.globals[t]) return undefined;
  if (docs.objects[objectId]?.[t]) return "documented";
  if (shorthand?.objects[objectId.toLowerCase()]?.[t]) return "extension";
  return "undocumented";
}

/** The first documented function in a binding funcId (for an Inspector hint). */
export function bindingHint(
  funcId: string,
  objectId: string | undefined,
  docs: CcoDocs | null
): { name: string; def: CcoFunc } | undefined {
  if (!docs) return undefined;
  for (const t of funcTokens(funcId)) {
    const def = funcDef(t, docs, objectId);
    if (def) return { name: t, def };
  }
  return undefined;
}
