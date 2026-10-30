// Rule 9 (heuristic, info-only): a binding's context object should be reachable.
// Engine-provided root contexts are not statically enumerable, so this only fires
// for types the document itself produces via a ContextPropagator somewhere — if a
// type is propagated in this file, a binding of that type with no self/ancestor
// propagator is suspicious (the province_details Public Order pattern:
// reference/cco-schema-sources.md). Benefit of the doubt everywhere else: an
// unresolvable propagator on the chain counts as providing anything, templated
// instances are skipped (their propagators may live in the template file), and
// components absent from the hierarchy are skipped.

import { callbacks } from "../../cco";
import { funcTokens } from "../../cco_docs";
import { ancestorGuids } from "../../doc";
import type { Diagnostic, Rule } from "../types";

/** The types a propagator produces: its funcId's return type per the docs, or
 *  "*" (provides anything) when unresolvable. */
const ANY = "*";

export const ccoPropagatorRule: Rule = {
  id: "cco-unpropagated",
  title: "Context object without a visible propagator",
  cost: "expensive",
  defaultSeverity: "info",
  run(ctx) {
    const docs = ctx.ccoDocs;
    if (!docs) return [];

    // Pass 1: what each component's ContextPropagators produce.
    const produces = new Map<string, Set<string>>();
    const producedAnywhere = new Set<string>();
    for (const c of ctx.classified) {
      if (c.kind !== "component" || !c.compGuid) continue;
      for (const cb of callbacks(c.comp)) {
        if (cb.id !== "ContextPropagator" || !cb.objectId || !cb.funcId) continue;
        const t = funcTokens(cb.funcId)[0];
        const ret = t ? docs.objects[cb.objectId]?.[t]?.ret : undefined;
        const produced = ret && ret.startsWith("Cco") ? ret : ANY;
        const set = produces.get(c.compGuid) ?? new Set<string>();
        set.add(produced);
        produces.set(c.compGuid, set);
        if (produced !== ANY) producedAnywhere.add(produced);
      }
    }
    if (producedAnywhere.size === 0) return [];

    // Pass 2: bindings of a doc-propagated type must see a propagator in scope.
    const out: Diagnostic[] = [];
    const chains = new Map<string, string[]>();
    for (const c of ctx.classified) {
      if (c.kind !== "component" || !c.compGuid || c.templated) continue;
      if (!ctx.hierGuids.has(c.compGuid)) continue;
      for (const cb of callbacks(c.comp)) {
        if (cb.id === "ContextPropagator") continue;
        const ty = cb.objectId;
        if (!ty || !producedAnywhere.has(ty)) continue;
        let chain = chains.get(c.compGuid);
        if (!chain) {
          chain = [c.compGuid, ...ancestorGuids(ctx.doc, c.compGuid)];
          chains.set(c.compGuid, chain);
        }
        const inScope = chain.some((g) => {
          const s = produces.get(g);
          return !!s && (s.has(ty) || s.has(ANY));
        });
        if (!inScope) {
          out.push({
            ruleId: "cco-unpropagated",
            severity: "info",
            message: `${ty} is bound here, but no ContextPropagator on this component or an ancestor provides it`,
            guid: c.compGuid,
          });
        }
      }
    }
    return out;
  },
};
