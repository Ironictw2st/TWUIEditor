// The diagnostics runner. Builds a shared context once, runs the registered rules,
// and returns a stably-sorted list. A rule that throws is swallowed so one bad rule
// can never crash the whole pass.

import { isElement, type CcoDocs, type CcoShorthand, type RawElement, type TwuiDocument } from "../../types/twui";
import { componentMap, getAttr, hierarchyRoot, layoutVersion } from "../doc";
import { classifyComponents } from "./classify";
import { RULES } from "./rules";
import type { DiagContext, Diagnostic, Severity } from "./types";

function walkEls(el: RawElement, fn: (e: RawElement) => void): void {
  fn(el);
  for (const c of el.children) if (isElement(c)) walkEls(c, fn);
}

/** Store-resident data a caller may thread into the pass (CCO rules use it). */
export interface DiagExtras {
  ccoDocs?: CcoDocs | null;
  ccoShorthand?: CcoShorthand | null;
}

export function buildContext(doc: TwuiDocument, extras?: DiagExtras): DiagContext {
  const hierGuids = new Set<string>();
  const root = hierarchyRoot(doc);
  if (root)
    walkEls(root, (e) => {
      const g = getAttr(e, "this");
      if (g) hierGuids.add(g);
    });
  return {
    doc,
    version: layoutVersion(doc),
    compMap: componentMap(doc),
    hierGuids,
    classified: classifyComponents(doc),
    ccoDocs: extras?.ccoDocs,
    ccoShorthand: extras?.ccoShorthand,
  };
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Run the diagnostics rules over `doc`. With `cheapOnly`, only the cheap rules
 *  run (used by the live badge); otherwise the full set runs (panel pass). */
export function runDiagnostics(
  doc: TwuiDocument | null,
  opts?: { cheapOnly?: boolean } & DiagExtras,
): Diagnostic[] {
  if (!doc) return [];
  // The rule registry encodes twui semantics; decoded binary UIC layouts
  // (root <ui>, pre-3K games) are a different dialect — no rules apply.
  if (doc.root.tag === "ui") return [];
  const ctx = buildContext(doc, opts);
  const rules = opts?.cheapOnly ? RULES.filter((r) => r.cost === "cheap") : RULES;
  const out: Diagnostic[] = [];
  for (const r of rules) {
    try {
      out.push(...r.run(ctx));
    } catch {
      /* a single rule must never crash the pass */
    }
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.ruleId.localeCompare(b.ruleId));
}

/** Cheap-rule error count, for the debounced toolbar badge. */
export function cheapErrorCount(doc: TwuiDocument | null): number {
  return runDiagnostics(doc, { cheapOnly: true }).filter((d) => d.severity === "error").length;
}
