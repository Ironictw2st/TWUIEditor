// Rule 4: a reference-target GUID must not appear twice. Only component, state,
// and component_image GUIDs are checked — those are the ones other elements point
// at (hierarchy nodes, currentstate/defaultstate, componentimage), so a collision
// is a genuine break. Imagemetric <image> GUIDs are deliberately excluded: nothing
// references them and CA reuses the same one across a component's states. Working
// from ctx.classified (the structural component walk) also means hierarchy mirrors
// and embedded sub-layouts — which legitimately repeat GUIDs — are never counted.

import { getAttr, isNullGuid } from "../../doc";
import type { ClassifiedEl, Diagnostic, Rule } from "../types";

const UNIQUE_KINDS = new Set<ClassifiedEl["kind"]>(["component", "state", "component_image"]);

// Warning, not error: duplicate component GUIDs occur in shipping CA files
// (copy-pasted components whose GUID was never regenerated) and still load —
// identical copies collapse harmlessly when the editor builds its GUID map. It is
// a real smell worth surfacing (the editor cannot address such components
// uniquely), but it does not stop the layout loading, so it stays advisory.
export const duplicateGuidsRule: Rule = {
  id: "duplicate-guid",
  title: "Duplicate GUID",
  cost: "cheap",
  defaultSeverity: "warning",
  run(ctx) {
    const counts = new Map<string, number>();
    for (const c of ctx.classified) {
      if (!UNIQUE_KINDS.has(c.kind)) continue;
      const g = getAttr(c.el, "this");
      if (g && !isNullGuid(g)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }

    const out: Diagnostic[] = [];
    for (const [g, n] of counts) {
      if (n > 1) {
        out.push({
          ruleId: "duplicate-guid",
          severity: "warning",
          message: `Duplicate 'this' GUID (${n} occurrences)`,
          guid: g,
        });
      }
    }
    return out;
  },
};
