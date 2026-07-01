// Rule 2: a component's currentstate / defaultstate must resolve to one of its own
// <state> GUIDs. Skips templated instances, whose states live in the template file.

import { componentStates, getAttr, guidOf, isNullGuid } from "../../doc";
import type { Diagnostic, Rule } from "../types";

const STATE_REF_ATTRS = ["currentstate", "defaultstate"] as const;

export const stateRefsRule: Rule = {
  id: "state-ref",
  title: "Unresolved state reference",
  cost: "cheap",
  defaultSeverity: "error",
  run(ctx) {
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      if (c.kind !== "component" || c.templated) continue;
      const stateGuids = new Set(
        componentStates(c.comp)
          .map((s) => guidOf(s))
          .filter((g): g is string => !!g),
      );
      for (const attr of STATE_REF_ATTRS) {
        const v = getAttr(c.comp, attr);
        if (v && !isNullGuid(v) && !stateGuids.has(v)) {
          out.push({
            ruleId: "state-ref",
            severity: "error",
            message: `${attr} GUID does not match any <state> in this component`,
            guid: c.compGuid,
            attr,
          });
        }
      }
    }
    return out;
  },
};
