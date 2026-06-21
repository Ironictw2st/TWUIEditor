// Helpers over the CCO symbol table (parsed from the game UI docs by the Rust
// `load_cco_docs` command). Used to annotate Inspector bindings with each CCO
// function's return type + description.

import { CcoDocs, CcoFunc } from "../types/twui";

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
