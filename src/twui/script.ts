// Read a component's `script_id` — the link from a TWUI panel to its backing
// Lua script. It lives in a `ContextInitScriptObject` callback as a child
// property `name="script_id"`.

import { RawElement, TwuiDocument } from "../types/twui";
import { childByTag, componentMap, elementChildren, getAttr, hierarchyRoot } from "./doc";

/** The `script_id` declared by a component's ContextInitScriptObject callback. */
export function componentScriptId(comp: RawElement): string | undefined {
  const list = childByTag(comp, "callbackwithcontextlist");
  if (!list) return undefined;
  for (const cb of elementChildren(list)) {
    if (cb.tag !== "callback_with_context") continue;
    if (getAttr(cb, "callback_id") !== "ContextInitScriptObject") continue;
    const props = childByTag(cb, "child_m_user_properties");
    if (!props) continue;
    for (const p of elementChildren(props)) {
      if (p.tag === "property" && getAttr(p, "name") === "script_id") {
        return getAttr(p, "value") || undefined;
      }
    }
  }
  return undefined;
}

/**
 * The page-level script_id — the first `ContextInitScriptObject` declared
 * anywhere in the hierarchy (preorder). Some panels (e.g. the schemes panel)
 * declare it on a deep component, not the top panel.
 */
export function pageScriptId(doc: TwuiDocument): string | undefined {
  const root = hierarchyRoot(doc);
  if (!root) return undefined;
  const cmap = componentMap(doc);
  const find = (node: RawElement): string | undefined => {
    const guid = getAttr(node, "this");
    const comp = guid ? cmap.get(guid) : undefined;
    const id = comp ? componentScriptId(comp) : undefined;
    if (id) return id;
    for (const child of elementChildren(node)) {
      const r = find(child);
      if (r) return r;
    }
    return undefined;
  };
  return find(root);
}
