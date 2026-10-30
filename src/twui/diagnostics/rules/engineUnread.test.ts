import { describe, it, expect } from "vitest";
import type { RawElement, TwuiDocument } from "../../../types/twui";
import { buildContext } from "../engine";
import { engineReads, engineUnreadRule } from "./engineUnread";

function E(tag: string, attrs: Record<string, string>, children: RawElement[] = []): RawElement {
  return { kind: "element", tag, attrs: Object.entries(attrs), children, self_closing: children.length === 0 };
}

/** One component with one state holding one image metric. */
function docWith(opts: {
  version?: string;
  compAttrs?: Record<string, string>;
  stateAttrs?: Record<string, string>;
  imageAttrs?: Record<string, string>;
}): TwuiDocument {
  const hierarchy = E("hierarchy", {}, [E("root", { this: "R" }, [E("panel", { this: "P" })])]);
  const components = E("components", {}, [
    E("root", { this: "R", id: "root", uniqueguid: "R" }),
    E("panel", { this: "P", id: "panel", uniqueguid: "P", ...(opts.compAttrs ?? {}) }, [
      E("states", {}, [
        E("newstate", { this: "S1", name: "NewState", width: "40", height: "40", uniqueguid: "S1", ...(opts.stateAttrs ?? {}) }, [
          E("imagemetrics", {}, [E("image", { this: "I1", uniqueguid: "I1", componentimage: "CI1", ...(opts.imageAttrs ?? {}) })]),
        ]),
      ]),
    ]),
  ]);
  return { prolog: [], root: E("layout", { version: opts.version ?? "136" }, [hierarchy, components]) };
}

const run = (doc: TwuiDocument) => engineUnreadRule.run(buildContext(doc));

describe("engine-unread-attr", () => {
  it("is silent on attributes the game reads", () => {
    const out = run(
      docWith({
        compAttrs: { tooltipslocalised: "true", allowhorizontalresize: "false", priority: "100" },
        stateAttrs: { shadervars: "0,0,0,0", textlabel: "x" },
        imageAttrs: { dockpoint: "Center", isrelativeresize: "true" },
      }),
    );
    expect(out).toEqual([]);
  });

  it("flags an attribute no engine reader looks at, as info", () => {
    const out = run(docWith({ stateAttrs: { blockedanims: "1" }, imageAttrs: { dock_pointt: "Center" } }));
    expect(out.map((d) => d.attr).sort()).toEqual(["blockedanims", "dock_pointt"]);
    expect(out.every((d) => d.severity === "info" && d.ruleId === "engine-unread-attr")).toBe(true);
  });

  it("stays silent on UIEd bookkeeping the vanilla files carry", () => {
    const out = run(docWith({ stateAttrs: { stateeditordisplaypos: "10,10" }, compAttrs: { marked_for_deletion: "true", locked: "true", comment: "x" } }));
    expect(out).toEqual([]);
  });

  it("flags a wrongly cased name (the game's lookup is case-sensitive)", () => {
    const out = run(docWith({ compAttrs: { TooltipsLocalised: "true" } }));
    expect(out.map((d) => d.attr)).toEqual(["TooltipsLocalised"]);
  });

  it("accepts snake_case override names only on template instances", () => {
    expect(engineReads("component", "tooltips_localised", true)).toBe(true);
    expect(engineReads("component", "tooltips_localised", false)).toBe(false);
    const plain = run(docWith({ compAttrs: { tooltips_localised: "true" } }));
    expect(plain.map((d) => d.attr)).toEqual(["tooltips_localised"]);
    const templated = run(docWith({ compAttrs: { part_of_template: "true", tooltips_localised: "true" } }));
    expect(templated).toEqual([]);
  });

  it("notes attributes the game skips in this layout version", () => {
    // image metric uniqueguid: read only from v136 (vanilla v135 files never carry it)
    const v135 = run(docWith({ version: "135" }));
    expect(v135.map((d) => d.attr)).toEqual(["uniqueguid"]);
    expect(v135[0].message).toMatch(/layout version 135 \(read only from v136\)/);
    expect(run(docWith({ version: "136" }))).toEqual([]);
    // plain component callback attrs: read only before v115
    const cb = run(docWith({ compAttrs: { callbackid: "x" } }));
    expect(cb.map((d) => d.message)).toEqual([expect.stringMatching(/read only up to v114/)]);
  });

  it("is silent outside the 3K layout versions", () => {
    expect(run(docWith({ version: "142", stateAttrs: { stateeditordisplaypos: "1,1" } }))).toEqual([]);
  });
});
