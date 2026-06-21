// ComponentCreator: a component can embed a SEPARATE layout file as its content
// via a `ComponentCreator` callback carrying a `layout="<path>"` property (e.g.
// the court screen's office boxes load `ui/campaign ui/court_screen_minister_slot`).
// Here we read that path; compute.ts renders the referenced layout in the box.

import { RawElement, TwuiDocument } from "../types/twui";
import { childByTag, componentsSection, elementChildren, getAttr } from "./doc";

/** The layout path of a component's `ComponentCreator` callback, if it has one. */
export function componentCreatorLayout(comp: RawElement): string | undefined {
  for (const tag of ["callbackwithcontextlist", "callbacks_with_context"]) {
    const list = childByTag(comp, tag);
    if (!list) continue;
    for (const cb of elementChildren(list)) {
      if (cb.tag !== "callback_with_context") continue;
      if (getAttr(cb, "callback_id") !== "ComponentCreator") continue;
      const props = childByTag(cb, "child_m_user_properties");
      if (!props) continue;
      for (const p of elementChildren(props)) {
        if (getAttr(p, "name") === "layout") {
          const v = getAttr(p, "value");
          if (v) return v;
        }
      }
    }
  }
  return undefined;
}

/** All distinct `ComponentCreator` layout paths referenced in a document. */
export function collectCreatorPaths(doc: TwuiDocument): string[] {
  const out = new Set<string>();
  const comps = componentsSection(doc);
  if (!comps) return [];
  for (const comp of elementChildren(comps)) {
    const p = componentCreatorLayout(comp);
    if (p) out.add(p);
  }
  return [...out];
}
