// Shared visibility decision, used by both the canvas layout (compute.ts) and the
// hierarchy tree (TreePanel), so the two never disagree about what's hidden.
//
// A component can be hidden by: a Simulation override, a script binding
// (ContextVisibilitySetter / ContextTrashOnCondition evaluated against the data pack),
// a campaign/faction condition, a perspective token filter, or the static
// `visible`/`is_visible="false"` attribute — in that priority order.

import { FactionContext, RawElement, TwuiDocument } from "../types/twui";
import { ContextTokens, conditionDecision, contextDecision } from "./context";
import { Scope, propagate, scriptVisibility } from "./cco";
import { activeState, componentMap, elementChildren, getAttr, guidOf, hierarchyRoot } from "./doc";

/** Only the show/hide lists matter here (kept structural to avoid importing compute.ts). */
type SimVis = { show: string[]; hide: string[] };

/** A component is statically hidden when EITHER its tag or its active state says so. */
function staticVisible(comp: RawElement, state: RawElement | undefined): boolean {
  const hidden = (el: RawElement | undefined) =>
    !!el && (getAttr(el, "visible") === "false" || getAttr(el, "is_visible") === "false");
  return !hidden(comp) && !hidden(state);
}

/** Whether a component renders, given its evaluation scope and the active context. */
export function isComponentVisible(
  comp: RawElement,
  state: RawElement | undefined,
  scope: Scope,
  ctx?: FactionContext,
  tokens?: ContextTokens,
  sim?: SimVis
): boolean {
  const g = guidOf(comp);
  if (g && sim) {
    if (sim.hide.includes(g)) return false;
    if (sim.show.includes(g)) return true;
  }
  const sv = scriptVisibility(comp, scope);
  if (sv === "show") return true;
  if (sv === "hide") return false;
  if (ctx) {
    if (conditionDecision(comp, ctx) === "hide") return false;
    if (tokens) {
      const d = contextDecision(getAttr(comp, "id"), ctx, tokens);
      if (d === "show") return true;
      if (d === "hide") return false;
    }
  }
  return staticVisible(comp, state);
}

/** Walk the hierarchy (applying ContextPropagator scope down each branch) and collect the
 *  guids of components that are NOT visible. No Sim — the tree isn't a simulation. */
export function hiddenGuids(
  doc: TwuiDocument,
  scope: Scope,
  ctx?: FactionContext,
  tokens?: ContextTokens
): Set<string> {
  const hidden = new Set<string>();
  const root = hierarchyRoot(doc);
  if (!root) return hidden;
  const cmap = componentMap(doc);
  const walk = (node: RawElement, sc: Scope) => {
    for (const child of elementChildren(node)) {
      const comp = cmap.get(guidOf(child) ?? "");
      if (!comp) continue;
      const childScope = propagate(comp, sc);
      const state = activeState(comp);
      if (!isComponentVisible(comp, state, childScope, ctx, tokens)) {
        const g = guidOf(comp);
        if (g) hidden.add(g);
      }
      walk(child, childScope);
    }
  };
  walk(root, scope);
  return hidden;
}
