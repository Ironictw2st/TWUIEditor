// Rule 8: `isrelativeresize="true"` on a state image whose size differs from its
// state's size CAN reposition the image in-engine so that a meaningful `dockpoint`
// fails (observed: a 72x72 icon docked "Top Center" in a 400px-wide component
// rendered far left of centre; removing the flag fixed it — see
// mcp-twui/design/editor-updates-loot-case-findings.md, finding 3). The editor's
// static preview does not model the flag, so the divergence is invisible headlessly.
//
// Info, not warning — calibrated against the corpus (2026-07): the same
// flag+dockpoint+mismatch combination appears 214 times across 48 shipping CA
// files (hud_battle, city_info_bar, army_id, ...) that render correctly in-game,
// and in our own verified-good panels. The predicate therefore cannot separate
// broken from intentional; it is an advisory pointer for when an image renders
// somewhere other than where its dockpoint says, not a defect signal. Skips
// templated instances (sizes resolve in the template file) and neutral dockpoints
// (absent / "Top Left" / "None" — the engine default, where the override changes
// nothing the author asked for).

import type { RawElement } from "../../../types/twui";
import { componentImages, componentStates, getAttr, guidOf, isNullGuid, stateImages } from "../../doc";
import type { Diagnostic, Rule } from "../types";

const NEUTRAL_DOCKPOINTS = new Set(["", "None", "Top Left"]);

/** Parse a width/height attribute; null when absent or non-numeric. */
function dim(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const imageResizeDockRule: Rule = {
  id: "image-relative-resize-dock",
  title: "isrelativeresize defeats dockpoint",
  cost: "cheap",
  defaultSeverity: "info",
  run(ctx) {
    const out: Diagnostic[] = [];
    for (const c of ctx.classified) {
      if (c.kind !== "component" || c.templated) continue;
      const ciByGuid = new Map<string, RawElement>();
      for (const ci of componentImages(c.comp)) {
        const g = guidOf(ci);
        if (g) ciByGuid.set(g, ci);
      }
      for (const state of componentStates(c.comp)) {
        const sw = dim(getAttr(state, "width"));
        const sh = dim(getAttr(state, "height"));
        if (sw === null && sh === null) continue;
        for (const img of stateImages(state)) {
          if (getAttr(img, "isrelativeresize") !== "true") continue;
          const dock = getAttr(img, "dockpoint") ?? "";
          if (NEUTRAL_DOCKPOINTS.has(dock)) continue;
          // Effective image size: the image metric's own w/h, falling back to the
          // referenced <component_image> definition's w/h.
          const ref = getAttr(img, "componentimage");
          const ci = ref && !isNullGuid(ref) ? ciByGuid.get(ref) : undefined;
          const iw = dim(getAttr(img, "width")) ?? (ci ? dim(getAttr(ci, "width")) : null);
          const ih = dim(getAttr(img, "height")) ?? (ci ? dim(getAttr(ci, "height")) : null);
          const mismatch = (sw !== null && iw !== null && iw !== sw) || (sh !== null && ih !== null && ih !== sh);
          if (!mismatch) continue;
          out.push({
            ruleId: "image-relative-resize-dock",
            severity: "info",
            message:
              `isrelativeresize may override dockpoint "${dock}" in-game: ` +
              `image is ${iw ?? "?"}x${ih ?? "?"} but the state is ${sw ?? "?"}x${sh ?? "?"} ` +
              `(if the image renders off-anchor, remove the flag or size the component to the image)`,
            guid: getAttr(img, "this") ?? guidOf(state) ?? c.compGuid,
            attr: "isrelativeresize",
          });
        }
      }
    }
    return out;
  },
};
