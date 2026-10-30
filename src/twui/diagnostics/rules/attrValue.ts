// Rule 5: every known attribute's value must pass validateAttr for its schema type
// (enum / number / colour / vec2 / bool). Unknown attributes (no schema) and empty
// values are skipped by construction, so this never fires a false positive.

import { getAttr } from "../../doc";
import { schemaFor, validateAttr } from "../../schema";
import type { Diagnostic, Rule } from "../types";

export const attrValueRule: Rule = {
  id: "attr-value",
  title: "Invalid attribute value",
  cost: "expensive",
  defaultSeverity: "warning",
  run(ctx) {
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      for (const [name, value] of c.el.attrs) {
        const leType = c.kind === "layoutEngine" ? getAttr(c.el, "type") : undefined;
        const schema = schemaFor(name, c.kind, ctx.version, leType);
        if (!schema) continue;
        const msg = validateAttr(schema, value);
        if (msg) {
          out.push({
            ruleId: "attr-value",
            severity: "warning",
            message: `${name}: ${msg}`,
            guid: c.guid,
            attr: name,
          });
        }
      }
    }
    return out;
  },
};
