// Interpret a subset of TWUI's CcoScriptObject context expressions so the
// editor can drive panels from the connected script's data pack (the table a
// script publishes via set_context_value). This is generic — it reads the
// panel's own List/ContextList, ContextImageSetter, ContextTextLabel,
// ContextPropagator and Context(Visibility|Trash) callbacks, not any one panel.

import { CcoShorthand, PreviewBinding, ShorthandDef } from "../types/twui";
import { RawElement } from "../types/twui";
import { childByTag, elementChildren, getAttr } from "./doc";
import { LuaValue } from "./lua";
import { RECORD_LOC } from "./recordLoc";

export interface Scope {
  /** The connected script's published table. */
  dataPack: LuaValue | null;
  /** The current list entry being bound (a row's data). */
  entry?: LuaValue;
  /** The current entry's map key (for `self.Id` / `Key`). */
  entryKey?: string;
  /** The current component's own `id` — `self.Id` for a non-list component. */
  selfId?: string;
  /** The enclosing entry for `this` inside a Filter/FirstContext sub-iteration. */
  thisEntry?: LuaValue;
  /** Named sub-contexts from ContextPropagator (e.g. `Reward`). */
  vars: Record<string, LuaValue>;
  /** The hierarchy parent's resolved image paths (slot order), for
   *  `self.ParentContext.ImagePath(N)`. Threaded down by the layout walk. */
  parentImages?: string[];
  /** Content-defined CCO shorthand macros (`ui/cco/*.json`), keyed by CCO type. */
  shorthand?: CcoShorthand;
  /** The current callback's context object type (e.g. `CcoCampaignCharacter`). */
  objectId?: string;
  /** Macro names currently being expanded — guards against self-reference loops. */
  expanding?: Set<string>;
  /** Editor-preview affordance: when no data pack is connected, a data-bound list renders
   *  its template once as a layout skeleton instead of collapsing to nothing. Off in
   *  data/sim renders (where real entries drive repetition). */
  previewEmptyLists?: boolean;
  /** User-set UI preference booleans (the game's `PrefAsBool("name")`), e.g.
   *  `ui_alternative_unit_cards`. Drives preference-gated state/visibility in the preview. */
  uiPrefs?: Record<string, boolean>;
  /** Editor-only DB-table preview binding in effect for this subtree: the container repeats
   *  its template child per row and mapped descendants draw column values. Set on each
   *  repeated row's scope by the layout walk; preserved down the subtree by `propagate`. */
  previewBinding?: PreviewBinding;
}

/** Find a shorthand macro by name: the current context object's table first,
 *  else any object's table that defines it. */
function lookupShorthand(name: string, scope: Scope): ShorthandDef | undefined {
  const objs = scope.shorthand?.objects;
  if (!objs) return undefined;
  if (scope.objectId) {
    const def = objs[scope.objectId.toLowerCase()]?.[name];
    if (def) return def;
  }
  for (const key of Object.keys(objs)) {
    const def = objs[key]?.[name];
    if (def) return def;
  }
  return undefined;
}

/** Enter a macro's body with the recursion guard armed; undefined if already expanding. */
function enterMacro(def: ShorthandDef, scope: Scope): Scope | undefined {
  const expanding = scope.expanding ?? new Set<string>();
  if (expanding.has(def.name)) return undefined;
  return { ...scope, expanding: new Set(expanding).add(def.name) };
}

/** Value context: a macro's `select` clauses (first matching `if`, else the clause
 *  with no `if`) or its simple `return` expression, evaluated as a value. */
function evalShorthandValue(def: ShorthandDef, scope: Scope, loc?: Record<string, string>): LuaValue | undefined {
  const inner = enterMacro(def, scope);
  if (!inner) return undefined;
  if (def.select.length) {
    for (const clause of def.select) {
      if (clause.cond == null) return evalExpr(clause.ret, inner, loc); // default clause
      if (evalCondition(clause.cond, inner) === true) return evalExpr(clause.ret, inner, loc);
    }
    return undefined;
  }
  if (def.ret != null) return evalExpr(def.ret, inner, loc);
  return undefined;
}

/** Boolean context: a `return`-form macro's body is itself a condition (e.g. a
 *  ContextVisibilitySetter funcId of `ExCanHaveTitle`); a `select` macro folds to
 *  the truthiness of its value. */
function evalShorthandCond(def: ShorthandDef, scope: Scope): boolean | undefined {
  if (def.ret != null && !def.select.length) {
    const inner = enterMacro(def, scope);
    if (!inner) return undefined;
    return evalCondition(def.ret, inner);
  }
  const v = evalShorthandValue(def, scope);
  return v === undefined ? undefined : !!v;
}

interface Callback {
  id: string;
  objectId?: string;
  funcId?: string;
  /** Position among all callback_with_context (document order) — for editing. */
  index: number;
}

/**
 * Decode XML entities. The raw document keeps attribute values escaped for
 * round-trip fidelity (`&quot;`, `&amp;&amp;`, `&gt;=`, …), but expressions must
 * be evaluated on the real characters. `&amp;` is decoded last to avoid
 * double-decoding. Display text is decoded the same way.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Inverse of decodeEntities — `&amp;` first so it isn't double-encoded. */
export function encodeEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Parse a component's callbacks into a flat list (funcId decoded). Inline
 * components use `<callbackwithcontextlist>`; templated components
 * (`part_of_template`) use `<callbacks_with_context>` — read both.
 */
export function callbacks(comp: RawElement): Callback[] {
  const out: Callback[] = [];
  let index = 0;
  for (const tag of ["callbackwithcontextlist", "callbacks_with_context"]) {
    const list = childByTag(comp, tag);
    if (!list) continue;
    for (const cb of elementChildren(list)) {
      if (cb.tag !== "callback_with_context") continue;
      const funcId = getAttr(cb, "context_function_id");
      out.push({
        id: getAttr(cb, "callback_id") ?? "",
        objectId: getAttr(cb, "context_object_id"),
        funcId: funcId !== undefined ? decodeEntities(funcId) : undefined,
        index: index++,
      });
    }
  }
  return out;
}

export function asRecord(v: LuaValue | undefined): Record<string, LuaValue> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, LuaValue>) : undefined;
}

/** Normalize a data-pack sub-table (map or array) to an ordered entry list. */
export function toEntries(table: LuaValue | undefined): { key: string; value: LuaValue }[] {
  if (Array.isArray(table)) return table.map((value, i) => ({ key: String(i), value }));
  const rec = asRecord(table);
  if (rec) return Object.keys(rec).map((key) => ({ key, value: rec[key] }));
  return [];
}

/** Model a parsed script table as CcoScriptObject "nodes": each entry becomes a
 *  `{ Key, Value }` node, recursively (a record/array Value becomes its own node list).
 *  This lets the row bindings — `Value.FirstContext(Key == "title_key").Value` — resolve
 *  through the normal ref-chain engine: `Value` is the node's child list, `FirstContext`
 *  finds the `{Key,Value}` child, and the trailing `.Value` reads its value. */
export function scriptNodes(table: LuaValue | undefined): LuaValue[] {
  return toEntries(table).map((e) => ({ Key: e.key, Value: nodeValue(e.value) }));
}
function nodeValue(v: LuaValue): LuaValue {
  return v !== null && typeof v === "object" ? scriptNodes(v) : v;
}

/** True if a List/ContextList funcId iterates a CcoScriptObject table's values
 *  (`TableValue.Value`) rather than a named sub-table (`TableValue.ValueForKey("k")`). */
export function isScriptValueList(funcId: string | undefined): boolean {
  return !!funcId && /TableValue\s*\.\s*Value\b/.test(funcId) && !/ValueForKey/.test(funcId);
}

/** The data-pack table key a List/ContextList callback iterates, or null. */
export function listSource(comp: RawElement): string | null {
  for (const cb of callbacks(comp)) {
    if (cb.id !== "List" && cb.id !== "ContextList") continue;
    const f = cb.funcId;
    if (!f || !/TableValue\b/.test(f)) continue;
    const m =
      /TableValue\.ValueForKey\(\s*"([^"]+)"\s*\)/.exec(f) ?? /TableValue\.(\w+)/.exec(f);
    if (m) return m[1];
  }
  return null;
}

/** Split an expression on a top-level binary operator (respecting quotes/parens). */
function splitTop(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    inStr = false,
    q = "",
    cur = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      cur += ch;
      if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(cur);
      cur = "";
      i += op.length - 1;
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function literal(p: string): string | null {
  const m = /^"([^"]*)"$/.exec(p) ?? /^'([^']*)'$/.exec(p);
  return m ? m[1] : null;
}

/** Split on a top-level '.' (respecting quotes/parens) — for ref chains. */
function splitDots(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    inStr = false,
    q = "",
    cur = "";
  for (const ch of expr) {
    if (inStr) {
      cur += ch;
      if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "." && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** Match a leading `name(...)` with balanced parens → { name, arg, rest }. */
function headCall(expr: string): { name: string; arg: string; rest: string } | null {
  const m = /^([A-Za-z]\w*)\(/.exec(expr);
  if (!m) return null;
  let depth = 0,
    inStr = false,
    q = "";
  let i = m[0].length - 1; // at '('
  for (; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      q = ch;
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) break;
  }
  if (depth !== 0) return null;
  return { name: m[1], arg: expr.slice(m[0].length, i), rest: expr.slice(i + 1) };
}

const KNOWN_FUNCS = new Set(["Loc", "ToUpper", "RoundFloat", "YearFormat"]);

/** Resolve a dotted ref chain with accessors (ValueForKey/Size/Filter/FirstContext). */
function evalRefChain(expr: string, scope: Scope, loc?: Record<string, string>): LuaValue | undefined {
  const segs = splitDots(expr.replace(/ScriptObjectContext\(\s*"[^"]*"\s*\)\./g, ""));
  // Inside Filter/FirstContext, bare names are the inner item; `this` is the
  // enclosing (outer) entry.
  const subScope = (e: { key: string; value: LuaValue }): Scope => ({
    ...scope,
    entry: e.value,
    entryKey: e.key,
    thisEntry: scope.entry ?? scope.thisEntry,
  });
  let cur: LuaValue | undefined;
  for (let idx = 0; idx < segs.length; idx++) {
    const seg = segs[idx].trim();
    const vfk = /^ValueForKey\(\s*"([^"]+)"\s*\)$/.exec(seg);
    const hvk = /^HasValueForKey\(\s*"([^"]+)"/.exec(seg);
    const filt = /^Filter\(([\s\S]*)\)$/.exec(seg);
    const first = /^FirstContext\(([\s\S]*)\)$/.exec(seg);
    if (idx === 0) {
      // EffectBundleFromKey(<expr>) -> a record with the bundle's loc text, so a
      // trailing `.Name`/`.Description` resolves via the property path below.
      const ebk = /^EffectBundleFromKey\(([\s\S]*)\)$/.exec(seg);
      if (ebk) {
        const k = evalExpr(ebk[1], scope, loc);
        if (typeof k === "string") {
          // Build the record from the shared loc-prefix registry (single source of truth).
          const prefixes = RECORD_LOC["CcoEffectBundle"];
          cur = Object.fromEntries(
            Object.entries(prefixes).map(([prop, prefix]) => [prop, loc?.[prefix + k] ?? null])
          );
        } else {
          cur = undefined;
        }
        continue;
      }
      if (seg === "TableValue") cur = scope.dataPack ?? undefined;
      else if (seg === "this") cur = scope.thisEntry ?? scope.entry;
      else if (seg === "self") cur = { Id: scope.entryKey ?? scope.selfId ?? "" };
      // `Internal` is a runtime node's (CcoRTTierNode/CcoRTNormal) underlying script node —
      // i.e. the current bound entry. So `Internal.unit_card` / `Internal.item_list` /
      // `Internal.Total` resolve their field off the row in scope.
      else if (seg === "Internal") cur = scope.entry;
      else if (scope.vars[seg] !== undefined) cur = scope.vars[seg];
      else if (vfk) cur = asRecord(scope.entry)?.[vfk[1]];
      else cur = asRecord(scope.entry)?.[seg];
      continue;
    }
    if (vfk) cur = asRecord(cur)?.[vfk[1]];
    else if (hvk) cur = !!asRecord(cur) && hvk[1] in (asRecord(cur) as object);
    else if (seg === "Size") cur = Array.isArray(cur) ? cur.length : toEntries(cur).length;
    else if (filt)
      cur = toEntries(cur)
        .filter((e) => evalCondition(filt[1], subScope(e)) === true)
        .map((e) => e.value);
    else if (first)
      cur = toEntries(cur).find((e) => evalCondition(first[1], subScope(e)) === true)?.value;
    else {
      const next = asRecord(cur)?.[seg];
      // Property form of a shorthand macro (`PlayersFaction.SpecialPooledResourceBar`):
      // if the segment isn't a plain field but names a macro, expand it (best effort —
      // the macro body resolves against whatever context is available).
      if (next === undefined && /^[A-Za-z]\w*$/.test(seg)) {
        const def = lookupShorthand(seg, scope);
        if (def) {
          cur = evalShorthandValue(def, { ...scope, entry: cur ?? scope.entry }, loc);
          continue;
        }
      }
      cur = next;
    }
  }
  return cur;
}

/**
 * Evaluate a CcoScriptObject expression to a value. Handles string concat,
 * literals, the functions Loc/ToUpper/RoundFloat/YearFormat (nestable), and
 * ref chains with ValueForKey/Size/Filter/FirstContext accessors.
 */
export function evalExpr(expr: string, scope: Scope, loc?: Record<string, string>): LuaValue | undefined {
  expr = expr.trim();
  if (!expr) return undefined;

  // Lambda `( a = e1, b = e2 ) => body` — bind the assignments into scope vars,
  // then evaluate the body (used by some ContextTooltipSetter funcIds).
  const arrow = splitTop(expr, "=>");
  if (arrow.length >= 2 && arrow[0].trim().startsWith("(") && arrow[0].trim().endsWith(")")) {
    const params = arrow[0].trim().slice(1, -1);
    const body = arrow.slice(1).join("=>").trim();
    const vars = { ...scope.vars };
    for (const a of splitTop(params, ",")) {
      const m = /^\s*(\w+)\s*=\s*([\s\S]+)$/.exec(a);
      if (m) vars[m[1]] = evalExpr(m[2], { ...scope, vars }, loc) ?? null;
    }
    return evalExpr(body, { ...scope, vars }, loc);
  }

  const parts = splitTop(expr, "+");
  if (parts.length > 1) {
    let out = "";
    for (const p of parts) {
      const v = evalExpr(p, scope, loc);
      if (v === undefined || v === null) return undefined;
      out += String(v);
    }
    return out;
  }

  const lit = literal(expr);
  if (lit !== null) return lit;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "nil") return null;

  // `self.ParentContext.ImagePath(N)` / `ParentContext.ImagePath(N)` — the hierarchy
  // parent's resolved image at slot N (threaded in via scope.parentImages). Unresolved
  // (no parent / index out of range) → undefined, so the static placeholder survives.
  const pim = /^(?:self\.)?ParentContext\.ImagePath\(\s*(\d+)\s*\)$/.exec(expr);
  if (pim) {
    const p = scope.parentImages?.[Number(pim[1])];
    return p && p.length ? p : undefined;
  }

  const call = headCall(expr);
  if (call && call.rest === "") {
    if (call.name === "GetIfElse") {
      // GetIfElse(cond, then, else) — cond via evalCondition; undefined → else.
      const args = splitTop(call.arg, ",");
      if (args.length === 3) {
        const cond = evalCondition(args[0].trim(), scope);
        return evalExpr((cond ? args[1] : args[2]).trim(), scope, loc);
      }
    }
    if (call.name === "GetIf") {
      // GetIf(cond, then) — then if cond else "" (so it concatenates cleanly).
      const args = splitTop(call.arg, ",");
      if (args.length === 2)
        return evalCondition(args[0].trim(), scope) ? evalExpr(args[1].trim(), scope, loc) : "";
    }
    if (call.name === "IsContextValid") {
      const v = evalExpr(call.arg, scope, loc);
      return v !== undefined && v !== null && v !== false;
    }
    if (call.name === "Format") {
      // Format(fmt, …args) — printf-style %s substitution.
      const args = splitTop(call.arg, ",");
      const fmt = evalExpr(args[0].trim(), scope, loc);
      if (typeof fmt !== "string") return undefined;
      let i = 1;
      return fmt.replace(/%s/g, () => {
        const a = evalExpr((args[i++] ?? "").trim(), scope, loc);
        return a == null ? "" : String(a);
      });
    }
    if (call.name === "HasValueForKey") {
      const km = /^\s*"([^"]+)"/.exec(call.arg);
      const rec = asRecord(scope.entry);
      return km ? !!rec && km[1] in rec : undefined;
    }
    if (call.name === "PrefAsBool") {
      // A user-facing UI preference (`PrefAsBool("ui_alternative_unit_cards")`). Resolves
      // from the viewer's uiPrefs map; unset → false (the game default for these flags).
      const km = /^\s*"([^"]+)"/.exec(call.arg);
      return km ? scope.uiPrefs?.[km[1]] ?? false : false;
    }
    if (KNOWN_FUNCS.has(call.name)) {
      const a = evalExpr(call.arg, scope, loc);
      switch (call.name) {
        case "Loc":
          return typeof a === "string" ? loc?.[a] ?? a : undefined;
        case "ToUpper":
          return a == null ? undefined : String(a).toUpperCase();
        case "RoundFloat":
          return typeof a === "number" ? Math.round(a) : a ?? undefined;
        case "YearFormat":
          return a == null ? undefined : String(a);
      }
    }
  }

  // Bare `IsValidContext` = is the *current (self)* context valid — true only when a data
  // entry is actually bound (e.g. an assigned character). Empty slots have no entry → false,
  // which hides per-character info/tooltip blocks gated by `IsValidContext && …`.
  if (expr === "IsValidContext") return scope.entry !== undefined;

  // `<chain>.IsValidContext` — the property form of `IsContextValid(<chain>)`: true iff
  // the chain resolves to a present context. Unresolvable optional contexts → false (hidden),
  // which gates overlays like the governor-appointment panel (`…StoredContext(…).IsValidContext`).
  if (expr.endsWith(".IsValidContext")) {
    const v = evalExpr(expr.slice(0, -".IsValidContext".length), scope, loc);
    return v !== undefined && v !== null && v !== false;
  }

  const chained = evalRefChain(expr, scope, loc);
  if (chained !== undefined) return chained;

  // A bare identifier may be a content-defined shorthand macro (`ui/cco/*.json`),
  // e.g. a ContextVisibilitySetter funcId of `ExCanHaveTitle`. Expand it only as a
  // fallback, so real data-pack fields always take precedence.
  if (/^[A-Za-z]\w*$/.test(expr)) {
    const def = lookupShorthand(expr, scope);
    if (def) return evalShorthandValue(def, scope, loc);
  }
  return chained;
}

/** Replace inline `{{Type:expr}}` tokens in a text string (tt tokens stripped). */
export function resolveInlineTokens(text: string, scope: Scope, loc?: Record<string, string>): string {
  if (!text.includes("{{")) return text;
  return text.replace(/\{\{([A-Za-z]+):([\s\S]*?)\}\}/g, (_m, type: string, expr: string) => {
    if (type === "CcoScriptObject" || type === "CcoScriptTableNode") {
      const v = evalExpr(expr, scope, loc);
      return v == null ? "" : String(v);
    }
    return ""; // tt: tooltip refs and anything else → not display text
  });
}

/** Evaluate a ContextImageSetter expression (`"lit"+ref`, incl. FirstContext) to a path. */
export function evalImageSetter(funcId: string, scope: Scope): string | null {
  const v = evalExpr(funcId, scope);
  return typeof v === "string" && v.length > 0 && !v.includes("undefined") ? v : null;
}

/** Evaluate a ContextTextLabel expression to display text (loc-resolved). */
export function evalTextLabel(
  funcId: string,
  scope: Scope,
  loc?: Record<string, string>
): string | null {
  const v = evalExpr(funcId, scope, loc);
  return v == null ? null : String(v);
}

/** True if the whole expr is wrapped in one balanced pair of parens. */
function isWrapped(e: string): boolean {
  if (e[0] !== "(" || e[e.length - 1] !== ")") return false;
  let depth = 0,
    inStr = false,
    q = "";
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (inStr) {
      if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      q = ch;
    } else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && i < e.length - 1) return false;
    }
  }
  return true;
}

/**
 * Evaluate a boolean condition: `||`/`&&` (with precedence), the comparisons
 * `==`/`!=`/`>=`/`<=`/`>`/`<`, parentheses, and bare truthiness — operands go
 * through `evalExpr`. Returns `undefined` when it can't be decided (e.g. a
 * non-script context), so static visibility still wins.
 */
export function evalCondition(funcId: string, scope: Scope): boolean | undefined {
  let expr = funcId.trim();
  while (isWrapped(expr)) expr = expr.slice(1, -1).trim();

  const ors = splitTop(expr, "||");
  if (ors.length > 1) {
    let unknown = false;
    for (const o of ors) {
      const v = evalCondition(o, scope);
      if (v === true) return true;
      if (v === undefined) unknown = true;
    }
    return unknown ? undefined : false;
  }
  const ands = splitTop(expr, "&&");
  if (ands.length > 1) {
    let unknown = false;
    for (const a of ands) {
      const v = evalCondition(a, scope);
      if (v === false) return false;
      if (v === undefined) unknown = true;
    }
    return unknown ? undefined : true;
  }
  for (const op of [">=", "<=", "!=", "==", ">", "<"]) {
    const parts = splitTop(expr, op);
    if (parts.length === 2) {
      const a = evalExpr(parts[0].trim(), scope);
      const b = evalExpr(parts[1].trim(), scope);
      if (a === undefined || b === undefined) return undefined;
      switch (op) {
        case "==":
          return a === b;
        case "!=":
          return a !== b;
        case ">=":
          return Number(a) >= Number(b);
        case "<=":
          return Number(a) <= Number(b);
        case ">":
          return Number(a) > Number(b);
        case "<":
          return Number(a) < Number(b);
      }
    }
  }
  // A bare identifier may be a content-defined shorthand macro whose body is itself
  // a condition (e.g. a ContextVisibilitySetter funcId of `ExCanHaveTitle`).
  if (/^[A-Za-z]\w*$/.test(expr)) {
    const def = lookupShorthand(expr, scope);
    if (def) return evalShorthandCond(def, scope);
  }

  const v = evalExpr(expr, scope);
  return v === undefined ? undefined : !!v;
}

/** Apply a ContextPropagator that binds a sub-context (e.g. `Reward`) or, for a
 *  court office box, the post key (`__postKey` = the box's id) for the embedded slot. */
export function propagate(comp: RawElement, scope: Scope): Scope {
  // `self.Id` for a non-list component is its own `id` (e.g. a pooled-resource holder
  // gated by `PlayersFaction.SpecialPooledResourceBar == self.Id`). List rows keep
  // their row key (entryKey wins in evalRefChain), so this only fills the non-row case.
  const selfId = getAttr(comp, "id");
  let vars = scope.vars;
  let entry = scope.entry;
  for (const cb of callbacks(comp)) {
    if (cb.id !== "ContextPropagator" || !cb.funcId) continue;
    // Court office post: `GovermentPostForKey(self.Id)` → bind the post key (self.Id =
    // the box's id) so the slot's `CharacterList` resolves the assigned character.
    if (/GovermentPostForKey\(\s*self\.Id\s*\)/.test(cb.funcId)) {
      const id = getAttr(comp, "id");
      if (id) vars = { ...vars, __postKey: id };
      continue;
    }
    // Faction-character context (e.g. `PlayersFaction.FactionLeaderContext`, propagated onto a
    // portrait's mask/holder): bind the assigned character record as the entry so a descendant
    // Character2DDisplayCreator resolves its `ArtContext` portrait. Only when it resolves to an
    // assigned character (a record carrying ArtContext); otherwise leave the entry untouched.
    if (/^PlayersFaction\.\w+Context$/.test(cb.funcId)) {
      const rec = asRecord(evalExpr(cb.funcId, scope));
      if (rec && rec.ArtContext !== undefined) entry = rec;
      continue;
    }
    const m =
      /(\w+)\s*:\s*(?:ScriptObjectContext\([^)]*\)\.)?TableValue\.(\w+)\.FirstContext\(\s*(\w+)\s*==\s*this\.(\w+)\s*\)/.exec(
        cb.funcId
      );
    if (!m) continue;
    const [, varName, table, lhs, field] = m;
    const want = asRecord(scope.entry)?.[field];
    const found = toEntries(asRecord(scope.dataPack)?.[table]).find((e) =>
      lhs === "Key" ? e.key === want : asRecord(e.value)?.[lhs] === want
    );
    if (found) vars = { ...vars, [varName]: found.value };
  }
  if (vars === scope.vars && scope.selfId === selfId && entry === scope.entry) return scope;
  return { ...scope, vars, selfId: selfId ?? scope.selfId, entry };
}

/**
 * Visibility forced by a condition (evaluated against the given scope):
 * ContextVisibilitySetter shows when true / hides when false; ContextTrashOnCondition
 * hides when true. Works for both script and DB contexts, but only acts when the
 * condition is *decided* — an undecidable condition (e.g. unresolvable DB state) yields
 * `undefined` so static visibility still wins (we never hide on "don't know"). This is
 * what hides optional sub-content like a character's spouse frame: its gate is
 * `IsContextValid(SpouseContext)`, which resolves to `false` when no spouse is present.
 */
export function scriptVisibility(
  comp: RawElement,
  scope: Scope
): "show" | "hide" | undefined {
  for (const cb of callbacks(comp)) {
    if (cb.id !== "ContextVisibilitySetter" && cb.id !== "ContextTrashOnCondition") continue;
    if (!cb.funcId) continue;
    // A table-row condition needs a row to evaluate against.
    if (cb.objectId === "CcoScriptTableNode" && scope.entry === undefined) continue;
    const v = evalCondition(cb.funcId, {
      ...scope,
      objectId: cb.objectId,
      selfId: scope.selfId ?? getAttr(comp, "id"),
    });
    if (v === undefined) continue;
    if (cb.id === "ContextVisibilitySetter") return v ? "show" : "hide";
    if (v === true) return "hide"; // ContextTrashOnCondition
  }
  return undefined;
}

/** First ContextImageSetter / ContextTextLabel funcId on a component, if any. */
export function imageSetterFunc(comp: RawElement): string | undefined {
  return callbacks(comp).find((c) => c.id === "ContextImageSetter")?.funcId;
}
export function textLabelFunc(comp: RawElement): string | undefined {
  return callbacks(comp).find((c) => c.id === "ContextTextLabel")?.funcId;
}
