// Resolve a component's tooltip for Tooltip mode: a script-driven
// `ContextTooltipSetter` funcId (best-effort via the evaluator), else a static
// `tooltip_text` attribute. TWUI tooltip text carries `[[…]]` markup tags and
// `{{tt:…}}` layout refs which we strip for plain display.

import { RawElement } from "../types/twui";
import { activeState, getAttr } from "./doc";
import { callbacks, decodeEntities, evalExpr, Scope } from "./cco";

/** Strip `[[col:red]]…[[/col]]`/`[[b]]` markup tags and `{{tt:…}}` layout refs. */
export function cleanTooltipMarkup(s: string): string {
  return s
    .replace(/\{\{[^}]*\}\}/g, "") // tooltip-layout / token refs — not plain text
    .replace(/\[\[[^\]]*\]\]/g, "") // [[col]] [[b]] [[/col]] … markup tags
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * The tooltip text for a component, or null. Prefers a resolvable
 * `ContextTooltipSetter` (evaluated against `scope`), else static `tooltip_text`
 * (on the component or its active state).
 */
export function resolveTooltip(
  comp: RawElement,
  scope: Scope,
  loc?: Record<string, string>
): string | null {
  const cb = callbacks(comp).find((c) => c.id === "ContextTooltipSetter");
  if (cb?.funcId) {
    const v = evalExpr(cb.funcId, scope, loc);
    if (typeof v === "string" && v.trim()) {
      const t = cleanTooltipMarkup(v);
      if (t) return t;
    }
  }

  const st = activeState(comp);
  const raw = getAttr(comp, "tooltip_text") ?? (st ? getAttr(st, "tooltip_text") : undefined);
  if (raw) {
    const t = cleanTooltipMarkup(decodeEntities(raw));
    if (t) return t;
  }
  return null;
}
