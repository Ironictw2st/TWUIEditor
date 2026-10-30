// Type-inference over the CCO documentation symbol table (`CcoDocs`), used to power
// type-aware autocomplete in the expression editor. Given a partial ref chain like
// `PlayersFaction.FactionLeaderContext`, walk the docs to infer the type at the caret,
// then list that type's members. Pure and game-agnostic: everything is driven by the
// provided `CcoDocs` (which reloads per game) and degrades to empty when docs are absent.

import { CcoDocs, CcoFunc } from "../types/twui";

export interface TypeCtx {
  docs: CcoDocs | null;
  /** The receiver type of a bare/`self`/`this` root — the callback's context_object_id. */
  selfType?: string;
}

export interface Completion {
  name: string;
  ret: string;
  list: boolean;
  args: string;
  desc: string;
}

export interface ChainType {
  type?: string;
  isList: boolean;
}

/** Engine root accessors that aren't documented globals but seed a type. */
const ENGINE_ROOTS = new Set(["self", "this", "Component", "ScriptObjectContext", "TableValue"]);

/** Accessors whose return type is fixed regardless of the receiver. */
function accessorType(name: string, cur: ChainType): ChainType | null {
  switch (name) {
    case "Size":
      return { type: "Int", isList: false };
    case "ValueForKey":
      return { type: undefined, isList: false }; // untyped script value → terminates
    case "HasValueForKey":
    case "Any":
    case "IsContextValid":
    case "StringContains":
    case "Contains":
      return { type: "Bool", isList: false };
    case "Filter":
      return { type: cur.type, isList: true }; // same element type, still a list
    case "FirstContext":
    case "First":
      return { type: cur.type, isList: false }; // collapse list to element
    default:
      return null;
  }
}

/** The leading identifier of a segment (`FactionLeaderContext` from `FactionLeaderContext(...)`). */
function segName(seg: string): string {
  return /^\s*([A-Za-z_]\w*)/.exec(seg)?.[1] ?? "";
}

/** Map a root accessor token to its starting CCO type (undefined = untyped/unknown). */
export function rootType(token: string, ctx: TypeCtx): string | undefined {
  const name = segName(token);
  const g = ctx.docs?.globals?.[name];
  if (g) return g.ret || undefined;
  if (name === "self" || name === "this" || name === "") return ctx.selfType;
  if (name === "Component") return ctx.docs?.globals?.Component?.ret || "CcoComponent";
  if (name === "ScriptObjectContext") return ctx.docs?.globals?.ScriptObjectContext?.ret || "CcoScriptObject";
  return undefined; // TableValue (script-pack root) and unknown tokens terminate
}

/** Walk a dotted ref chain (already split on top-level `.`) to the type at its end. */
export function resolveChainType(segments: string[], ctx: TypeCtx): ChainType {
  let cur: ChainType = { type: ctx.selfType, isList: false };
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    if (!seg) continue;
    const name = segName(seg);
    // Segment 0 may be a root accessor (global / engine root) rather than a member.
    if (i === 0 && (ctx.docs?.globals?.[name] || ENGINE_ROOTS.has(name))) {
      cur = { type: rootType(seg, ctx), isList: ctx.docs?.globals?.[name]?.list ?? false };
      if (cur.type === undefined) return { type: undefined, isList: false };
      continue;
    }
    const acc = accessorType(name, cur);
    if (acc) {
      cur = acc;
    } else {
      const def = cur.type ? ctx.docs?.objects?.[cur.type]?.[name] : undefined;
      cur = def ? { type: def.ret || undefined, isList: def.list } : { type: undefined, isList: false };
    }
    if (cur.type === undefined) return { type: undefined, isList: false };
  }
  return cur;
}

function toCompletion(name: string, f: CcoFunc): Completion {
  return { name, ret: f.ret, list: f.list, args: f.args, desc: f.desc };
}

/** Prefix filter + rank: startsWith before includes, then alphabetical. */
function rank(items: Completion[], prefix: string): Completion[] {
  const p = prefix.toLowerCase();
  return items
    .filter((c) => !p || c.name.toLowerCase().includes(p))
    .sort((a, b) => {
      const as = a.name.toLowerCase().startsWith(p) ? 0 : 1;
      const bs = b.name.toLowerCase().startsWith(p) ? 0 : 1;
      return as - bs || a.name.localeCompare(b.name);
    });
}

/** Members available after `type.` (prefix-filtered). Falls back to the union of all
 *  documented member names when `type` is unknown, so the user still gets suggestions. */
export function memberCompletions(type: string | undefined, prefix: string, ctx: TypeCtx): Completion[] {
  const docs = ctx.docs;
  if (!docs) return [];
  const own = type ? docs.objects[type] : undefined;
  if (own) return rank(Object.entries(own).map(([n, f]) => toCompletion(n, f)), prefix);
  // Fallback: all member names across every type, deduped (first definition wins).
  const seen = new Map<string, Completion>();
  for (const fns of Object.values(docs.objects)) {
    for (const [n, f] of Object.entries(fns)) if (!seen.has(n)) seen.set(n, toCompletion(n, f));
  }
  return rank([...seen.values()], prefix);
}

/** Root-position completions: documented global accessors + engine roots (prefix-filtered). */
export function rootCompletions(prefix: string, ctx: TypeCtx): Completion[] {
  const docs = ctx.docs;
  if (!docs) return [];
  const out = new Map<string, Completion>();
  for (const [n, f] of Object.entries(docs.globals)) out.set(n, toCompletion(n, f));
  // Synthetic engine roots not present as documented globals.
  const eng: Record<string, string> = {
    self: ctx.selfType ?? "",
    this: ctx.selfType ?? "",
    TableValue: "",
  };
  for (const [n, ret] of Object.entries(eng)) {
    if (!out.has(n)) out.set(n, { name: n, ret, list: false, args: "", desc: "" });
  }
  return rank([...out.values()], prefix);
}
