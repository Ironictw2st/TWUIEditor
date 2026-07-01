// Rule 3: each state image's `componentimage` GUID must resolve to a
// <component_image> defined in the same component. Skips templated instances,
// whose images resolve against the template file.

import { componentImages, componentStates, getAttr, guidOf, isNullGuid, stateImages } from "../../doc";
import type { Diagnostic, Rule } from "../types";

export const imageRefsRule: Rule = {
  id: "image-ref",
  title: "Unresolved component-image reference",
  cost: "cheap",
  defaultSeverity: "error",
  run(ctx) {
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      if (c.kind !== "component" || c.templated) continue;
      const ciGuids = new Set(
        componentImages(c.comp)
          .map((ci) => guidOf(ci))
          .filter((g): g is string => !!g),
      );
      for (const state of componentStates(c.comp)) {
        for (const img of stateImages(state)) {
          const ref = getAttr(img, "componentimage");
          if (ref && !isNullGuid(ref) && !ciGuids.has(ref)) {
            out.push({
              ruleId: "image-ref",
              severity: "error",
              message: "Image references a missing <component_image>",
              guid: getAttr(img, "this") ?? guidOf(state) ?? c.compGuid,
              attr: "componentimage",
            });
          }
        }
      }
    }
    return out;
  },
};
