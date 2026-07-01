// Rule 1: <hierarchy> and <components> must agree.
//  - A hierarchy node with no component definition is a hard error (broken file).
//  - A component never referenced in the hierarchy is advisory (warning) and is
//    gated off for runtime-instantiated components (templated / create_ingame),
//    which legitimately lack a hierarchy node.

import { getAttr } from "../../doc";
import type { Diagnostic, Rule } from "../types";

export const hierarchyComponentsRule: Rule = {
  id: "hierarchy-component",
  title: "Hierarchy / components mismatch",
  cost: "cheap",
  defaultSeverity: "error",
  run(ctx) {
    const out: Diagnostic[] = [];

    for (const g of ctx.hierGuids) {
      if (!ctx.compMap.has(g)) {
        out.push({
          ruleId: "hierarchy-component",
          severity: "error",
          message: "Hierarchy node has no matching <components> definition",
          guid: g,
        });
      }
    }

    for (const [g, comp] of ctx.compMap) {
      if (ctx.hierGuids.has(g)) continue;
      const templated = getAttr(comp, "part_of_template") === "true";
      const createIngame = getAttr(comp, "create_ingame") === "true";
      if (templated || createIngame) continue;
      out.push({
        ruleId: "hierarchy-component",
        severity: "warning",
        message: "Component is never referenced in the hierarchy",
        guid: g,
      });
    }

    return out;
  },
};
