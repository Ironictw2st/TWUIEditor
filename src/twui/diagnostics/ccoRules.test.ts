// Tests for the CCO diagnostics rules (cco-undocumented / cco-unpropagated),
// built on the province_details Public Order pattern they were designed around
// (reference/cco-schema-sources.md).

import { describe, expect, it } from "vitest";
import type { CcoDocs, CcoFunc, CcoShorthand, RawElement, TwuiDocument } from "../../types/twui";
import { buildContext } from "./engine";
import { ccoUndocumentedRule } from "./rules/ccoUndocumented";
import { ccoPropagatorRule } from "./rules/ccoPropagator";

function E(tag: string, attrs: Record<string, string>, children: RawElement[] = []): RawElement {
  return { kind: "element", tag, attrs: Object.entries(attrs), children, self_closing: children.length === 0 };
}

function fn(ret: string, opts?: Partial<CcoFunc>): CcoFunc {
  return { ret, list: false, args: "Void", desc: "", ...opts };
}

/** A CcoDocs mirroring the 3K public-order surface: the sub-object is
 *  metadata-verified; CcoCampaignProvince is documented (HTML) but NOT verified. */
const DOCS: CcoDocs = {
  objects: {
    CcoCampaignProvincePublicOrder: {
      PublicOrder: fn("Int", { meta: true }),
      PublicOrderEffectsList: fn("CcoStringValue", { meta: true, list: true }),
    },
    CcoCampaignProvince: {
      PublicOrderContext: fn("CcoCampaignProvincePublicOrder"),
    },
  },
  globals: { PlayersFaction: fn("CcoCampaignFaction") },
  verified: ["CcoCampaignProvincePublicOrder"],
};

const SHORTHAND: CcoShorthand = {
  objects: {
    ccocampaignprovincepublicorder: {
      ExTooltipContext: { name: "ExTooltipContext", ret: "CcoRTPublicOrder(…)", select: [] },
    },
  },
};

function cb(callbackId: string, objectId?: string, funcId?: string): RawElement {
  const attrs: Record<string, string> = { callback_id: callbackId };
  if (objectId) attrs.context_object_id = objectId;
  if (funcId) attrs.context_function_id = funcId;
  return E("callback_with_context", attrs);
}

/** One-component-per-entry doc: [guid, parentGuid|null, callbacks[]]. */
function makeDoc(entries: [string, string | null, RawElement[]][]): TwuiDocument {
  const nodes = new Map<string, RawElement>();
  for (const [g] of entries) nodes.set(g, E(g.toLowerCase(), { this: g }));
  let root: RawElement | undefined;
  for (const [g, parent] of entries) {
    if (parent) nodes.get(parent)!.children.push(nodes.get(g)!);
    else root = nodes.get(g)!;
  }
  const hierarchy = E("hierarchy", {}, [root!]);
  const components = E(
    "components",
    {},
    entries.map(([g, , cbs]) =>
      E(g.toLowerCase(), { this: g, id: g.toLowerCase(), uniqueguid: g }, [E("callbackwithcontextlist", {}, cbs)]),
    ),
  );
  return { prolog: [], root: E("layout", { version: "135" }, [hierarchy, components]) };
}

function runUndocumented(doc: TwuiDocument) {
  return ccoUndocumentedRule.run(buildContext(doc, { ccoDocs: DOCS, ccoShorthand: SHORTHAND }));
}
function runPropagator(doc: TwuiDocument) {
  return ccoPropagatorRule.run(buildContext(doc, { ccoDocs: DOCS, ccoShorthand: SHORTHAND }));
}

describe("cco-undocumented", () => {
  it("flags a typo'd property on a metadata-verified type", () => {
    const doc = makeDoc([["A", null, [cb("ContextTextLabel", "CcoCampaignProvincePublicOrder", "PublicOrderTxet")]]]);
    const out = runUndocumented(doc);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("PublicOrderTxet");
    expect(out[0].guid).toBe("A");
  });

  it("accepts a documented property", () => {
    const doc = makeDoc([["A", null, [cb("ContextTextLabel", "CcoCampaignProvincePublicOrder", "PublicOrder")]]]);
    expect(runUndocumented(doc)).toHaveLength(0);
  });

  it("stays silent on a type without metadata symbols (asymmetric proof rule)", () => {
    // The original province_details bug: dead binding, but unverifiable type.
    const doc = makeDoc([["A", null, [cb("ContextTextLabel", "CcoCampaignProvince", "PublicOrder")]]]);
    expect(runUndocumented(doc)).toHaveLength(0);
  });

  it("accepts a ui/cco extension macro", () => {
    const doc = makeDoc([
      ["A", null, [cb("ContextCustomTooltipStore", "CcoCampaignProvincePublicOrder", "ExTooltipContext")]],
    ]);
    expect(runUndocumented(doc)).toHaveLength(0);
  });

  it("judges only the first token (Filter predicates resolve on element types)", () => {
    const doc = makeDoc([
      [
        "A",
        null,
        [cb("ContextList", "CcoCampaignProvincePublicOrder", "Filter(PublicOrderEffectsList, IntValue < 0)")],
      ],
    ]);
    expect(runUndocumented(doc)).toHaveLength(0);
  });

  it("skips CcoRT* tooltip constructors and globals", () => {
    const doc = makeDoc([
      ["A", null, [cb("ContextCustomTooltipStore", "CcoCampaignProvincePublicOrder", "CcoRTPublicOrder( Name:{X} )")]],
      ["B", "A", [cb("ContextTextLabel", "CcoCampaignProvincePublicOrder", "PlayersFaction.Name")]],
    ]);
    expect(runUndocumented(doc)).toHaveLength(0);
  });
});

describe("cco-unpropagated", () => {
  const PROP = cb("ContextPropagator", "CcoCampaignProvince", "PublicOrderContext");
  const BIND = cb("ContextTextLabel", "CcoCampaignProvincePublicOrder", "PublicOrder");

  it("accepts a binding under a self or ancestor propagator", () => {
    const doc = makeDoc([
      ["A", null, [PROP]],
      ["B", "A", [BIND]], // descendant — inherits
      ["C", null, []],
    ]);
    // C is unreachable from A: give C its own propagated binding on the same component.
    const doc2 = makeDoc([["S", null, [PROP, BIND]]]);
    expect(runPropagator(doc)).toHaveLength(0);
    expect(runPropagator(doc2)).toHaveLength(0);
  });

  it("flags a binding of a doc-propagated type with no propagator in scope", () => {
    const doc = makeDoc([
      ["A", null, [PROP]],
      ["B", "A", []],
      ["X", null, [BIND]], // sibling of A — out of scope
    ]);
    const out = runPropagator(doc);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("info");
    expect(out[0].guid).toBe("X");
  });

  it("stays silent when the type is never resolvably propagated in the doc", () => {
    // No propagator at all: engine-provided contexts must not be second-guessed.
    const doc = makeDoc([["X", null, [BIND]]]);
    expect(runPropagator(doc)).toHaveLength(0);
  });

  it("gives an unresolvable propagator the benefit of the doubt", () => {
    const unresolvable = cb("ContextPropagator", "CcoCampaignProvince", "MysteryContext");
    const doc = makeDoc([
      ["A", null, [PROP]], // makes the type doc-propagated
      ["B", "A", [BIND]],
      ["Y", null, [unresolvable]],
      ["Z", "Y", [BIND]], // under an unresolvable propagator — do not flag
    ]);
    expect(runPropagator(doc)).toHaveLength(0);
  });
});
