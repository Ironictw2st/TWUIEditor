// Rule 8: a callback binding on a metadata-verified CCO type must reference a
// documented property. Verified types are the 55 (for 3K) whose ui/metadata.json
// entry carries `symbols` — the asymmetric proof rule (reference/cco-schema-sources.md):
// on any other type the rule stays silent, because absence there proves nothing.
// Only the FIRST non-engine token of context_function_id is judged; later tokens
// may legally resolve on list-element types inside Filter(...)-style predicates.
// Needs ctx.ccoDocs (threaded in by the panel); silent when absent.

import { callbacks } from "../../cco";
import { bindingStatus, funcTokens } from "../../cco_docs";
import type { Diagnostic, Rule } from "../types";

export const ccoUndocumentedRule: Rule = {
  id: "cco-undocumented",
  title: "Undocumented CCO property",
  cost: "expensive",
  defaultSeverity: "warning",
  run(ctx) {
    const docs = ctx.ccoDocs;
    if (!docs?.verified?.length) return [];
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      if (c.kind !== "component") continue;
      for (const cb of callbacks(c.comp)) {
        if (!cb.objectId || !cb.funcId) continue;
        const status = bindingStatus(cb.funcId, cb.objectId, docs, ctx.ccoShorthand ?? null);
        if (status !== "undocumented") continue;
        const t = funcTokens(cb.funcId)[0];
        out.push({
          ruleId: "cco-undocumented",
          severity: "warning",
          message: `"${t}" is not documented on ${cb.objectId} (metadata-verified type) — likely a dead binding`,
          guid: c.compGuid,
        });
      }
    }
    return out;
  },
};
