// Resolve a component's tooltip for Tooltip mode, in the engine's order:
//   1. a script-driven `ContextTooltipSetter` (evaluated best-effort) — its result may be
//      text or a `{{tt:<layout>}}` tooltip-layout ref;
//   2. the static localised tooltip (`tooltiplabel` -> uied_component_texts), else the
//      literal `tooltip` / `tooltip_text` (see textSource.ts for the per-dialect rules);
//   3. `componentleveltooltip`: a `{{tt:<layout>}}` ref, or (rarely) literal text.
// Text is returned raw with `[[…]]` markup kept; `{{tr:}}` / newlines are resolved here and
// the display layer parses the markup (richText.ts). A tooltip string may carry the game's
// `Title||Body` split.

import { RawElement } from "../types/twui";
import { activeState, getAttr } from "./doc";
import { callbacks, evalExpr, resolveInlineTokens, Scope } from "./cco";
import { resolveLocText } from "./richText";
import { staticTooltipOrigin } from "./textSource";

export type TooltipResult =
  | { kind: "text"; title?: string; text: string }
  /** A tooltip layout (`{{tt:ui/common ui/tooltip_ceo}}`), rendered in its own box. `fallback`
   *  is the static text, shown if the layout can't be loaded. */
  | { kind: "layout"; path: string; fallback?: TooltipResult };

const TT = /\{\{tt:([^}]+)\}\}/;

/** Strip `[[col:red]]…[[/col]]`/`[[b]]` markup tags and `{{tt:…}}` layout refs. */
export function cleanTooltipMarkup(s: string): string {
  return s
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** A resolved tooltip string -> text result (`Title||Body` split, tokens resolved). */
function textResult(raw: string, scope: Scope, loc?: Record<string, string>): TooltipResult | null {
  let s = resolveLocText(raw, loc);
  if (s.includes("{{")) s = resolveInlineTokens(s, scope, loc);
  const sep = s.indexOf("||");
  const title = sep >= 0 ? s.slice(0, sep).trim() : undefined;
  const text = (sep >= 0 ? s.slice(sep + 2) : s).replace(/[ \t]+\n/g, "\n").trim();
  if (!text && !title) return null;
  return title ? { kind: "text", title, text } : { kind: "text", text };
}

/** Plain text of a tooltip (for search/tests/fallback displays). */
export function tooltipPlainText(t: TooltipResult | null | undefined): string | null {
  if (!t) return null;
  if (t.kind === "layout") return t.fallback ? tooltipPlainText(t.fallback) : null;
  return cleanTooltipMarkup([t.title, t.text].filter(Boolean).join("\n"));
}

export function resolveTooltip(
  comp: RawElement,
  scope: Scope,
  loc?: Record<string, string>,
  state: RawElement | undefined = activeState(comp)
): TooltipResult | null {
  const origin = staticTooltipOrigin(comp, state, loc);
  const staticText = origin.text ? textResult(origin.text, scope, loc) : null;

  const cb = callbacks(comp).find((c) => c.id === "ContextTooltipSetter");
  if (cb?.funcId) {
    const v = evalExpr(cb.funcId, scope, loc);
    if (typeof v === "string" && v.trim()) {
      const tt = TT.exec(v);
      if (tt) return { kind: "layout", path: tt[1].trim(), fallback: staticText ?? undefined };
      const t = textResult(v, scope, loc);
      if (t) return t;
    }
  }

  const clt = getAttr(comp, "componentleveltooltip");
  const tt = clt ? TT.exec(clt) : null;
  if (tt) return { kind: "layout", path: tt[1].trim(), fallback: staticText ?? undefined };

  if (staticText) return staticText;
  // Literal component-level text (a handful of vanilla layouts put plain text here).
  return clt ? textResult(clt, scope, loc) : null;
}
