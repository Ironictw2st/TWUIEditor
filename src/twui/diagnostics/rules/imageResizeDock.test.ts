import { describe, it, expect } from "vitest";
import type { RawElement, TwuiDocument } from "../../../types/twui";
import { buildContext } from "../engine";
import { imageResizeDockRule } from "./imageResizeDock";

// --- Fixture builders ---------------------------------------------------------------------------

function E(tag: string, attrs: Record<string, string>, children: RawElement[] = []): RawElement {
  return { kind: "element", tag, attrs: Object.entries(attrs), children, self_closing: children.length === 0 };
}

/** A one-component document whose single state holds the given image metrics. */
function docWith(opts: {
  stateAttrs?: Record<string, string>;
  imageAttrs: Record<string, string>;
  ciAttrs?: Record<string, string>;
  compAttrs?: Record<string, string>;
}): TwuiDocument {
  const hierarchy = E("hierarchy", {}, [E("root", { this: "R" }, [E("panel", { this: "P" })])]);
  const components = E("components", {}, [
    E("root", { this: "R", id: "root", uniqueguid: "R" }),
    E("panel", { this: "P", id: "panel", uniqueguid: "P", ...(opts.compAttrs ?? {}) }, [
      E("componentimages", {}, [
        E("component_image", { this: "CI1", uniqueguid: "CI1", imagepath: "ui/a.png", ...(opts.ciAttrs ?? {}) }),
      ]),
      E("states", {}, [
        E("newstate", { this: "S1", name: "NewState", width: "400", height: "100", ...(opts.stateAttrs ?? {}) }, [
          E("imagemetrics", {}, [E("image", { componentimage: "CI1", ...opts.imageAttrs })]),
        ]),
      ]),
    ]),
  ]);
  return { prolog: [], root: E("layout", { version: "136" }, [hierarchy, components]) };
}

function run(doc: TwuiDocument) {
  return imageResizeDockRule.run(buildContext(doc));
}

// --- Tests --------------------------------------------------------------------------------------

describe("image-relative-resize-dock", () => {
  it("flags isrelativeresize + meaningful dockpoint + size mismatch (the loot-case bug)", () => {
    const out = run(
      docWith({ imageAttrs: { width: "72", height: "72", dockpoint: "Top Center", isrelativeresize: "true" } }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe("image-relative-resize-dock");
    expect(out[0].severity).toBe("info");
    expect(out[0].attr).toBe("isrelativeresize");
    expect(out[0].guid).toBe("S1"); // image carries no `this` -> falls back to the state guid
    expect(out[0].message).toContain('"Top Center"');
  });

  it("stays silent when image and state sizes match", () => {
    const out = run(
      docWith({
        stateAttrs: { width: "90", height: "90" },
        imageAttrs: { width: "90", height: "90", dockpoint: "Center", isrelativeresize: "true" },
      }),
    );
    expect(out).toHaveLength(0);
  });

  it("stays silent without isrelativeresize", () => {
    const out = run(docWith({ imageAttrs: { width: "72", height: "72", dockpoint: "Top Center" } }));
    expect(out).toHaveLength(0);
  });

  it('stays silent for neutral dockpoints (absent, "Top Left", "None")', () => {
    const neutrals: Record<string, string>[] = [{}, { dockpoint: "Top Left" }, { dockpoint: "None" }];
    for (const extra of neutrals) {
      const out = run(docWith({ imageAttrs: { width: "72", height: "72", isrelativeresize: "true", ...extra } }));
      expect(out).toHaveLength(0);
    }
  });

  it("falls back to the referenced component_image's size when the metric has none", () => {
    const out = run(
      docWith({
        ciAttrs: { width: "72", height: "72" },
        imageAttrs: { dockpoint: "Center", isrelativeresize: "true" },
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("72x72");
  });

  it("stays silent when no size is resolvable on either side", () => {
    const out = run(docWith({ imageAttrs: { dockpoint: "Center", isrelativeresize: "true" } }));
    expect(out).toHaveLength(0);
  });

  it("skips templated instances", () => {
    const out = run(
      docWith({
        compAttrs: { part_of_template: "true" },
        imageAttrs: { width: "72", height: "72", dockpoint: "Top Center", isrelativeresize: "true" },
      }),
    );
    expect(out).toHaveLength(0);
  });
});
