// Rule 6: flag an attribute that is present but not valid in this file's layout
// version. schemaFor returns the in-version schema variant when one exists, so
// this only fires when NO in-version variant exists for the attribute on that
// kind — exactly the right semantics. Silent when the version is unknown (0).

import { attrInVersion, schemaFor } from "../../schema";
import type { Diagnostic, Rule } from "../types";

export const attrVersionRule: Rule = {
  id: "attr-version",
  title: "Attribute not valid in this layout version",
  cost: "expensive",
  defaultSeverity: "warning",
  run(ctx) {
    if (!ctx.version) return [];
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      for (const [name] of c.el.attrs) {
        const schema = schemaFor(name, c.kind, ctx.version);
        if (schema && !attrInVersion(schema, ctx.version)) {
          out.push({
            ruleId: "attr-version",
            severity: "warning",
            message: `${name} is not valid in layout v${ctx.version}`,
            guid: c.guid,
            attr: name,
          });
        }
      }
    }
    return out;
  },
};
