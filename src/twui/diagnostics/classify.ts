// The single structural walk that tags every element under <components> with its
// schema `kind`. An element's kind cannot be read from its tag (component tags are
// component-named), so it is inferred from position — exactly as InspectorPanel
// does it. Every rule that needs per-element kind consumes ctx.classified instead
// of re-walking the tree.

import type { TwuiDocument, RawElement } from "../../types/twui";
import type { AttrKind } from "../schema";
import {
  childByTag,
  componentImages,
  componentStates,
  componentsSection,
  elementChildren,
  getAttr,
  getLayoutEngine,
  guidOf,
  stateImages,
} from "../doc";
import type { ClassifiedEl } from "./types";

export function classifyComponents(doc: TwuiDocument): ClassifiedEl[] {
  const out: ClassifiedEl[] = [];
  const comps = componentsSection(doc);
  if (!comps) return out;

  for (const comp of elementChildren(comps)) {
    const compGuid = guidOf(comp) ?? null;
    const templated = getAttr(comp, "part_of_template") === "true";
    const push = (el: RawElement, kind: AttrKind) =>
      out.push({ el, kind, guid: getAttr(el, "this") ?? compGuid, comp, compGuid, templated });

    push(comp, "component");

    const le = getLayoutEngine(comp);
    if (le) push(le, "layoutEngine");

    for (const st of componentStates(comp)) {
      push(st, "state");
      for (const img of stateImages(st)) push(img, "image");
    }

    for (const ci of componentImages(comp)) push(ci, "component_image");

    // WH3 / v142 3D model view (these elements carry no guid; tags per InspectorPanel).
    const mv = childByTag(comp, "component_model_view");
    if (mv) {
      push(mv, "model");
      const list = childByTag(mv, "model_list");
      if (list) for (const m of elementChildren(list).filter((e) => e.tag === "ComponentModel")) push(m, "model");
    }
  }
  return out;
}
