// Tooltip + static-text resolution order, on fixtures shaped like real 3K (state attrs) and
// WH3 (<localised_texts>) components.

import { describe, expect, it } from "vitest";
import type { RawElement } from "../types/twui";
import type { Scope } from "./cco";
import { UIED_TEXT, TEXT_REPLACEMENT } from "./richText";
import { stateText, stateTextOrigin } from "./textSource";
import { resolveTooltip, tooltipPlainText } from "./tooltip";

function E(tag: string, attrs: Record<string, string>, children: RawElement[] = []): RawElement {
  return { kind: "element", tag, attrs: Object.entries(attrs), children, self_closing: children.length === 0 };
}
const scope: Scope = { dataPack: null, vars: {} };
const loc = {
  [UIED_TEXT + "btn_Tooltip_1"]: "Localised tip",
  [UIED_TEXT + "lbl_Text_1"]: "Localised label",
  [UIED_TEXT + "wh3_tt"]: "WH3 tip",
  [UIED_TEXT + "wh3_txt"]: "WH3 text",
  [TEXT_REPLACEMENT + "gold"]: "[[col:flavour]]gold[[/col]]",
  greeting: "Hello",
};

/** A 3K-style component with one state. */
function comp3k(state: Record<string, string>, compAttrs: Record<string, string> = {}, extra: RawElement[] = []) {
  const st = E("active", { this: "S1", name: "active", ...state });
  return { comp: E("button", { this: "C1", ...compAttrs }, [E("states", {}, [st]), ...extra]), st };
}

describe("static text", () => {
  it("uses the textlabel loc row only when textlocalised is set", () => {
    const on = comp3k({ text: "literal", textlabel: "lbl_Text_1", textlocalised: "true" });
    expect(stateText(on.comp, on.st, loc)).toBe("Localised label");
    const off = comp3k({ text: "literal", textlabel: "lbl_Text_1" });
    expect(stateText(off.comp, off.st, loc)).toBe("literal");
  });
  it("falls back to the literal when the loc row is missing, and reports the key", () => {
    const c = comp3k({ text: "a &amp; b", textlabel: "missing", textlocalised: "true" });
    expect(stateTextOrigin(c.comp, c.st, loc)).toEqual({ text: "a & b", key: UIED_TEXT + "missing", localised: false });
  });
  it("reads WH3 localised_text rows by state name, localised by default", () => {
    const st = E("active", { this: "S1", name: "active" });
    const rows = E("localised_texts", {}, [
      E("localised_text", { state: "hover", text: "hover text" }),
      E("localised_text", { state: "active", text: "fallback", text_label: "wh3_txt" }),
    ]);
    const comp = E("button", { this: "C1" }, [E("states", {}, [st]), rows]);
    expect(stateText(comp, st, loc)).toBe("WH3 text");
    const rows2 = E("localised_texts", {}, [
      E("localised_text", { state: "active", text: "literal", text_label: "wh3_txt", is_text_localised: "false" }),
    ]);
    expect(stateText(E("button", {}, [E("states", {}, [st]), rows2]), st, loc)).toBe("literal");
  });
});

describe("resolveTooltip", () => {
  it("prefers the tooltiplabel loc row over the literal tooltip", () => {
    const c = comp3k({ tooltip: "literal tip", tooltiplabel: "btn_Tooltip_1" });
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({ kind: "text", text: "Localised tip" });
  });
  it("falls back to the literal state tooltip", () => {
    const c = comp3k({ tooltip: "Just text", tooltiplabel: "nope" });
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({ kind: "text", text: "Just text" });
  });
  it("uses a component-level tooltiplabel", () => {
    const c = comp3k({}, { tooltiplabel: "btn_Tooltip_1" });
    expect(tooltipPlainText(resolveTooltip(c.comp, scope, loc))).toBe("Localised tip");
  });
  it("expands {{tr:}} and keeps markup for the display layer", () => {
    const c = comp3k({ tooltip: "Costs {{tr:gold}}\\nNow" });
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({ kind: "text", text: "Costs [[col:flavour]]gold[[/col]]\nNow" });
  });
  it("splits Title||Body", () => {
    const c = comp3k({ tooltip: "Title||Body text" });
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({ kind: "text", title: "Title", text: "Body text" });
  });
  it("returns a layout ref for componentleveltooltip, with the static text as fallback", () => {
    const c = comp3k({ tooltip: "static" }, { componentleveltooltip: "{{tt:ui/common ui/tooltip_ceo}}" });
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({
      kind: "layout",
      path: "ui/common ui/tooltip_ceo",
      fallback: { kind: "text", text: "static" },
    });
  });
  it("prefers a resolvable ContextTooltipSetter", () => {
    const cbs = E("callbackwithcontextlist", {}, [
      E("callback_with_context", { callback_id: "ContextTooltipSetter", context_function_id: 'Loc(&quot;greeting&quot;)' }),
    ]);
    const c = comp3k({ tooltip: "static" }, {}, [cbs]);
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({ kind: "text", text: "Hello" });
  });
  it("routes a setter that yields {{tt:}} to the layout", () => {
    const cbs = E("callbackwithcontextlist", {}, [
      E("callback_with_context", { callback_id: "ContextTooltipSetter", context_function_id: '&quot;{{tt:ui/campaign ui/tooltip_breakdown}}&quot;' }),
    ]);
    const c = comp3k({}, {}, [cbs]);
    expect(resolveTooltip(c.comp, scope, loc)).toMatchObject({ kind: "layout", path: "ui/campaign ui/tooltip_breakdown" });
  });
  it("uses literal componentleveltooltip text", () => {
    const c = comp3k({}, { componentleveltooltip: "Left-click to undeploy" });
    expect(resolveTooltip(c.comp, scope, loc)).toEqual({ kind: "text", text: "Left-click to undeploy" });
  });
  it("returns null when there is nothing", () => {
    const c = comp3k({});
    expect(resolveTooltip(c.comp, scope, loc)).toBeNull();
  });
});
