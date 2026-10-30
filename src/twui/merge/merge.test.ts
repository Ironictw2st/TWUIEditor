import { describe, it, expect } from "vitest";
import type { RawElement, TwuiDocument } from "../../types/twui";
import { componentMap, componentsSection, elementChildren, getAttr, hierarchyRoot } from "../doc";
import { diffDocuments } from "./diff";
import { applyChanges } from "./apply";
import { selectAll } from "./types";

// --- Fixture builders ---------------------------------------------------------------------------

function E(tag: string, attrs: Record<string, string>, children: RawElement[] = []): RawElement {
  return { kind: "element", tag, attrs: Object.entries(attrs), children, self_closing: children.length === 0 };
}
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
function acceptedSet(diff: ReturnType<typeof diffDocuments>): Set<string> {
  return new Set(Object.keys(selectAll(diff)));
}
/** result's guid->def map as a plain object, for order-independent deep-equality. */
function compObj(doc: TwuiDocument): Record<string, RawElement> {
  const out: Record<string, RawElement> = {};
  for (const [g, el] of componentMap(doc)) out[g] = el;
  return out;
}

/** Document B: a small but structurally-varied layout (v136). */
function makeB(): TwuiDocument {
  const hierarchy = E("hierarchy", {}, [
    E("root", { this: "R" }, [
      E("panel", { this: "P" }, [E("button_ok", { this: "BOK" }), E("button_cancel", { this: "BC" })]),
      E("extra_panel", { this: "EP" }), // B-only (added relative to A)
    ]),
  ]);
  const components = E("components", {}, [
    E("root", { this: "R", id: "root", uniqueguid: "R" }),
    E("panel", { this: "P", id: "panel", uniqueguid: "P", priority: "200" }, [
      E("states", {}, [E("newstate", { this: "SP", name: "Active", width: "300", height: "200" })]),
      E("componentimages", {}, [E("component_image", { this: "G1", uniqueguid: "G1", imagepath: "ui/a.png" })]),
      E("localised_texts", {}, [E("localised_text", { state: "Active", text: "Hi" })]),
    ]),
    E("button_ok", { this: "BOK", id: "button_ok", uniqueguid: "BOK" }, [
      E("states", {}, [E("newstate", { this: "SB", name: "Active", width: "100", height: "40" })]),
      E("LayoutEngine", { type: "List", spacing: "4.00,4.00" }),
    ]),
    E("button_cancel", { this: "BC", id: "button_cancel", uniqueguid: "BC" }),
    E("extra_panel", { this: "EP", id: "extra_panel", uniqueguid: "EP", priority: "50" }), // last => add appends here
  ]);
  return { prolog: ['<?xml version="1.0" encoding="UTF-8"?>'], root: E("layout", { version: "136" }, [hierarchy, components]) };
}

/** Document A: B mutated — extra_panel removed, panel attr + text changed, button_ok state + LE changed. */
function makeA(): TwuiDocument {
  const a = makeB();
  const hierRoot = hierarchyRoot(a)!;
  // remove extra_panel from the hierarchy
  hierRoot.children = hierRoot.children.filter((c) => getAttr(c as RawElement, "this") !== "EP");
  // remove extra_panel def from components
  const comps = componentsSection(a)!;
  comps.children = comps.children.filter((c) => getAttr(c as RawElement, "this") !== "EP");

  const byGuid = componentMap(a);
  // panel: priority 200 -> 100, localised_text "Hi" -> "Hello"
  const panel = byGuid.get("P")!;
  panel.attrs.find((x) => x[0] === "priority")![1] = "100";
  const lt = elementChildren(elementChildren(panel).find((c) => c.tag === "localised_texts")!)[0];
  lt.attrs.find((x) => x[0] === "text")![1] = "Hello";
  // button_ok: state width 100 -> 120, LayoutEngine spacing 4,4 -> 8,8
  const bok = byGuid.get("BOK")!;
  const st = elementChildren(elementChildren(bok).find((c) => c.tag === "states")!)[0];
  st.attrs.find((x) => x[0] === "width")![1] = "120";
  const le = elementChildren(bok).find((c) => c.tag === "LayoutEngine")!;
  le.attrs.find((x) => x[0] === "spacing")![1] = "8.00,8.00";
  return a;
}

// --- Tests --------------------------------------------------------------------------------------

describe("diffDocuments", () => {
  it("reports zero changes for identical documents", () => {
    const b = makeB();
    const diff = diffDocuments(clone(b), clone(b));
    expect(diff.roots).toHaveLength(0);
  });

  it("detects add / modify / attr / nested changes", () => {
    const diff = diffDocuments(makeA(), makeB());
    const byGuid = new Map(diff.roots.map((r) => [r.compGuid, r]));
    // extra_panel is a B-only add
    expect(byGuid.get("EP")?.kind).toBe("add");
    // panel is a modify with an attr child (priority) and a localised_text child
    const panel = byGuid.get("P")!;
    expect(panel.kind).toBe("modify");
    const kinds = panel.children.map((c) => `${c.level}:${c.kind}`);
    expect(kinds).toContain("attr:modify");
    expect(kinds).toContain("localised_text:modify");
    // button_ok modify has a state child and a layoutEngine child
    const bok = byGuid.get("BOK")!;
    expect(bok.children.map((c) => c.level).sort()).toEqual(["layoutEngine", "state"]);
  });
});

describe("applyChanges", () => {
  it("accept-all turns A into B (component map + hierarchy + preserved GUIDs)", () => {
    const a = makeA();
    const b = makeB();
    const diff = diffDocuments(a, b);
    const result = clone(a);
    applyChanges(result, diff, acceptedSet(diff));

    // every component def matches B exactly (order-independent map compare)
    expect(compObj(result)).toEqual(compObj(b));
    // hierarchy matches B exactly (order IS significant and tracked)
    expect(hierarchyRoot(result)).toEqual(hierarchyRoot(b));
    // GUID preservation: the added subtree kept B's guid
    expect(componentMap(result).has("EP")).toBe(true);
  });

  it("partial accept applies only the chosen change", () => {
    const a = makeA();
    const b = makeB();
    const diff = diffDocuments(a, b);
    const result = clone(a);
    applyChanges(result, diff, new Set(["comp:P/attr:priority"]));

    const panel = componentMap(result).get("P")!;
    // the accepted attr flipped...
    expect(getAttr(panel, "priority")).toBe("200");
    // ...but the un-accepted localised_text stayed at A's value
    const lt = elementChildren(elementChildren(panel).find((c) => c.tag === "localised_texts")!)[0];
    expect(getAttr(lt, "text")).toBe("Hello");
    // ...and the un-accepted add did not happen
    expect(componentMap(result).has("EP")).toBe(false);
  });
});

describe("reorder", () => {
  it("accept-all reproduces B's sibling order", () => {
    const b = makeB();
    const a = clone(b);
    // swap button order in A's hierarchy
    const panelNode = elementChildren(hierarchyRoot(a)!).find((c) => c.tag === "panel")!;
    panelNode.children = [panelNode.children[1], panelNode.children[0]];

    const diff = diffDocuments(a, b);
    const result = clone(a);
    applyChanges(result, diff, acceptedSet(diff));

    const resPanel = elementChildren(hierarchyRoot(result)!).find((c) => c.tag === "panel")!;
    expect(elementChildren(resPanel).map((c) => getAttr(c, "this"))).toEqual(["BOK", "BC"]);
  });
});

describe("reparent (move)", () => {
  // B: root > [ panel > [child], other ] ; A moves `child` under `other`.
  function makeTree(): TwuiDocument {
    const hierarchy = E("hierarchy", {}, [
      E("root", { this: "R" }, [
        E("panel", { this: "P" }, [E("child", { this: "X" })]),
        E("other", { this: "O" }),
      ]),
    ]);
    const def = (g: string) => E(g === "R" ? "root" : g === "P" ? "panel" : g === "O" ? "other" : "child", { this: g, id: g, uniqueguid: g });
    const components = E("components", {}, [def("R"), def("P"), def("O"), def("X")]);
    return { prolog: [], root: E("layout", { version: "136" }, [hierarchy, components]) };
  }

  it("moves a node back under B's parent on accept-all", () => {
    const b = makeTree();
    const a = clone(b);
    // In A, move `child` (X) from panel (P) to other (O).
    const aRoot = hierarchyRoot(a)!;
    const aPanel = elementChildren(aRoot).find((c) => c.tag === "panel")!;
    const aOther = elementChildren(aRoot).find((c) => c.tag === "other")!;
    const x = elementChildren(aPanel)[0];
    aPanel.children = [];
    aOther.children = [x];

    const diff = diffDocuments(a, b);
    const move = diff.roots.find((r) => r.compGuid === "X");
    expect(move?.kind).toBe("move");

    const result = clone(a);
    applyChanges(result, diff, acceptedSet(diff));
    expect(hierarchyRoot(result)).toEqual(hierarchyRoot(b));
  });
});

describe("nested spine coverage", () => {
  // A component with a callback + two localised_texts + two component_images.
  function makeDoc(opts: { hoverText: string; withG2: boolean; fn: string }): TwuiDocument {
    const texts = [E("localised_text", { state: "Active", text: "Hi" }), E("localised_text", { state: "hover", text: opts.hoverText })];
    const images = [E("component_image", { this: "G1", uniqueguid: "G1", imagepath: "ui/a.png" })];
    if (opts.withG2) images.push(E("component_image", { this: "G2", uniqueguid: "G2", imagepath: "ui/b.png" }));
    const panel = E("panel", { this: "P", id: "panel", uniqueguid: "P" }, [
      E("states", {}, [E("newstate", { this: "S", name: "Active", width: "100", height: "40" })]),
      E("componentimages", {}, images),
      E("localised_texts", {}, texts),
      E("callbackwithcontextlist", {}, [
        E("callback_with_context", { callback_id: "OnClick", context_object_id: "obj", context_function_id: opts.fn }),
      ]),
    ]);
    const hierarchy = E("hierarchy", {}, [E("root", { this: "R" }, [E("panel", { this: "P" })])]);
    const components = E("components", {}, [E("root", { this: "R", id: "root", uniqueguid: "R" }), panel]);
    return { prolog: [], root: E("layout", { version: "136" }, [hierarchy, components]) };
  }

  it("detects callback + localised_text + component_image changes", () => {
    const a = makeDoc({ hoverText: "HeyA", withG2: false, fn: "Bar()" });
    const b = makeDoc({ hoverText: "Hey", withG2: true, fn: "Foo()" });
    const diff = diffDocuments(a, b);
    const panel = diff.roots.find((r) => r.compGuid === "P")!;
    const levels = panel.children.map((c) => `${c.level}:${c.kind}`).sort();
    expect(levels).toContain("callback:modify");
    expect(levels).toContain("localised_text:modify"); // hover text
    expect(levels).toContain("component_image:add"); // G2
  });

  it("partial accept applies only the chosen nested change", () => {
    const a = makeDoc({ hoverText: "HeyA", withG2: false, fn: "Bar()" });
    const b = makeDoc({ hoverText: "Hey", withG2: true, fn: "Foo()" });
    const diff = diffDocuments(a, b);
    const panel = diff.roots.find((r) => r.compGuid === "P")!;
    const cb = panel.children.find((c) => c.level === "callback")!;

    const result = clone(a);
    applyChanges(result, diff, new Set([cb.id]));

    const resPanel = componentMap(result).get("P")!;
    // callback function id adopted from B...
    const resCb = elementChildren(elementChildren(resPanel).find((c) => c.tag === "callbackwithcontextlist")!)[0];
    expect(getAttr(resCb, "context_function_id")).toBe("Foo()");
    // ...but the G2 image was NOT added (only the callback was accepted)
    expect(elementChildren(elementChildren(resPanel).find((c) => c.tag === "componentimages")!)).toHaveLength(1);
  });

  it("accept-all reproduces B exactly (spine + adopt)", () => {
    const a = makeDoc({ hoverText: "HeyA", withG2: false, fn: "Bar()" });
    const b = makeDoc({ hoverText: "Hey", withG2: true, fn: "Foo()" });
    const diff = diffDocuments(a, b);
    const result = clone(a);
    applyChanges(result, diff, acceptedSet(diff));
    expect(componentMap(result).get("P")).toEqual(componentMap(b).get("P"));
  });
});
