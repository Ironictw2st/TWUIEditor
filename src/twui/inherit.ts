// Detect what a component inherits from its ancestors. TWUI contexts flow
// parent→child: a script context (ContextInitScriptObject), per-row/list and
// propagated sub-contexts (List/ContextList, ContextPropagator), and state
// (StatePropagatorCallback). This surfaces them for display — it doesn't change
// rendering (the cco engine already threads these down).

import { RawElement, TwuiDocument } from "../types/twui";
import { ancestorGuids, componentMap, elementChildren, getAttr, guidOf, hierarchyRoot } from "./doc";
import { callbacks, listSource, propagate, Scope, toEntries } from "./cco";
import { componentScriptId } from "./script";
import { LuaValue } from "./lua";

export interface Inheritance {
  kind: "script" | "list" | "context" | "state";
  label: string;
  fromGuid: string;
  fromId: string;
}

/** Names of the ContextPropagator-bound vars on a component (e.g. `Reward`). */
function propagatedVars(comp: RawElement): string[] {
  const out: string[] = [];
  for (const cb of callbacks(comp)) {
    if (cb.id !== "ContextPropagator" || !cb.funcId) continue;
    const m = /\(\s*(\w+)\s*:/.exec(cb.funcId);
    if (m) out.push(m[1]);
  }
  return out;
}

function hasCallback(comp: RawElement, id: string): boolean {
  return callbacks(comp).some((c) => c.id === id);
}

/** What `guid` inherits from its ancestors (nearest-first within each kind). */
export function inheritedContexts(doc: TwuiDocument, guid: string): Inheritance[] {
  const comps = componentMap(doc);
  const out: Inheritance[] = [];
  const chain = ancestorGuids(doc, guid); // [root, …, parent]
  let haveScript = false;
  let haveList = false;
  let haveState = false;
  for (let i = chain.length - 1; i >= 0; i--) {
    const ag = chain[i];
    const ac = comps.get(ag);
    if (!ac) continue;
    const fromId = getAttr(ac, "id") ?? ac.tag;

    if (!haveScript) {
      const sid = componentScriptId(ac);
      if (sid) {
        out.push({ kind: "script", label: sid, fromGuid: ag, fromId });
        haveScript = true;
      }
    }
    if (!haveList) {
      const ls = listSource(ac);
      if (ls) {
        out.push({ kind: "list", label: ls, fromGuid: ag, fromId });
        haveList = true;
      }
    }
    for (const v of propagatedVars(ac)) {
      out.push({ kind: "context", label: v, fromGuid: ag, fromId });
    }
    if (!haveState && hasCallback(ac, "StatePropagatorCallback")) {
      out.push({ kind: "state", label: "", fromGuid: ag, fromId });
      haveState = true;
    }
  }
  return out;
}

/**
 * A representative binding scope for `guid` (for previewing its script lookups
 * in the Inspector): the data pack, the FIRST entry of the nearest inherited
 * list, plus any propagated sub-contexts along the ancestor chain.
 */
export function representativeScope(
  doc: TwuiDocument,
  guid: string,
  dataPack: LuaValue | null
): Scope {
  const comps = componentMap(doc);
  let scope: Scope = { dataPack, vars: {} };
  const list = inheritedContexts(doc, guid).find((i) => i.kind === "list");
  if (list && dataPack && typeof dataPack === "object" && !Array.isArray(dataPack)) {
    const entries = toEntries((dataPack as Record<string, LuaValue>)[list.label]);
    if (entries[0]) scope = { ...scope, entry: entries[0].value, entryKey: entries[0].key };
  }
  for (const g of [...ancestorGuids(doc, guid), guid]) {
    const c = comps.get(g);
    if (c) scope = propagate(c, scope);
  }
  return scope;
}

/**
 * GUIDs that inherit a non-script context (so the script — universal under the
 * panel — doesn't badge everything). One top-down pass.
 */
export function inheritingGuids(doc: TwuiDocument): Set<string> {
  const comps = componentMap(doc);
  const root = hierarchyRoot(doc);
  const set = new Set<string>();
  if (!root) return set;
  const walk = (node: RawElement, inherited: boolean) => {
    const g = guidOf(node);
    if (g && inherited) set.add(g);
    const comp = g ? comps.get(g) : undefined;
    let childInherited = inherited;
    if (comp) {
      if (listSource(comp)) childInherited = true;
      else if (hasCallback(comp, "ContextPropagator")) childInherited = true;
      else if (hasCallback(comp, "StatePropagatorCallback")) childInherited = true;
    }
    for (const c of elementChildren(node)) walk(c, childInherited);
  };
  walk(root, false);
  return set;
}
