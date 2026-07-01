// Rule 7: schema-driven required-attribute check. An attribute is required for a
// kind when its schema entry lists that kind in `requiredFor` (id -> component,
// width/height -> state). Data-driven so adding a requirement is a schema edit,
// not a code change. Skips templated instances (their dimensions live elsewhere).

import { getAttr } from "../../doc";
import { attrsFor } from "../../schema";
import type { Diagnostic, Rule } from "../types";

export const requiredAttrsRule: Rule = {
  id: "required-attr",
  title: "Missing required attribute",
  cost: "cheap",
  defaultSeverity: "warning",
  run(ctx) {
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      if (c.templated) continue;
      for (const s of attrsFor(c.kind, ctx.version)) {
        if (s.requiredFor?.includes(c.kind) && getAttr(c.el, s.name) === undefined) {
          out.push({
            ruleId: "required-attr",
            severity: "warning",
            message: `Missing required attribute "${s.name}"`,
            guid: c.guid,
            attr: s.name,
          });
        }
      }
    }
    return out;
  },
};
