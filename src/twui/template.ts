// Resolve templated component instances (part_of_template) against their
// template layout. A templated instance references its visuals indirectly:
//   - <state_uniqueguids>          : state name -> instance guid (refs only)
//   - <component_image_uniqueguids>: image path -> instance guid (ordered)
//   - <override_images>            : ordered list of image paths (overrides)
//   - dimensions="w,h"             : the instance size
// The real <states>/<imagemetrics>/<componentimages> live in the template file
// `ui/templates/<template_id>.twui.xml`. Images are overridden POSITIONALLY:
// override_images[i] replaces the template componentimages[i].

import { RawElement, TwuiDocument } from "../types/twui";
import {
  childByTag,
  componentImages,
  componentStates,
  elementChildren,
  getAttr,
  guidOf,
  parseVec2,
} from "./doc";

export interface ResolvedLayer {
  imagepath: string;
  width?: number;
  height?: number;
  dockpoint?: string;
  offset?: string;
  colour?: string;
}

export interface ResolvedTemplate {
  width: number;
  height: number;
  layers: ResolvedLayer[];
}

/** All distinct `template_id` values referenced anywhere in the document. */
export function collectTemplateIds(doc: TwuiDocument): string[] {
  const ids = new Set<string>();
  const walk = (el: RawElement) => {
    const t = getAttr(el, "template_id");
    if (t) ids.add(t);
    for (const c of elementChildren(el)) walk(c);
  };
  walk(doc.root);
  return [...ids];
}

export function isTemplated(comp: RawElement): boolean {
  if (getAttr(comp, "part_of_template") === "true") return true;
  return !!getAttr(comp, "template_id") && !!childByTag(comp, "state_uniqueguids");
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** The instance's ordered override image paths (normalised to forward slashes). */
function overrideImages(comp: RawElement): string[] {
  const ov = childByTag(comp, "override_images");
  if (ov) {
    return elementChildren(ov)
      .filter((e) => e.tag === "element")
      .map((e) => normalizeSlashes(getAttr(e, "value") ?? ""));
  }
  // Fall back to <component_image_uniqueguids> name attrs (also ordered).
  const cig = childByTag(comp, "component_image_uniqueguids");
  if (cig) {
    return elementChildren(cig).map((e) => normalizeSlashes(getAttr(e, "name") ?? ""));
  }
  return [];
}

/** The component in a template file that the instance instantiates (id == template id). */
function templateComponent(tplDoc: TwuiDocument, templateId: string): RawElement | undefined {
  const comps = childByTag(tplDoc.root, "components");
  if (!comps) return undefined;
  const list = elementChildren(comps);
  return (
    list.find((c) => getAttr(c, "id") === templateId) ??
    // else the first non-root component
    list.find((c) => getAttr(c, "id") !== "root")
  );
}

/** Pick the template's render state: current/default, else "active", else first. */
function templateActiveState(tplComp: RawElement): RawElement | undefined {
  const states = componentStates(tplComp);
  if (states.length === 0) return undefined;
  const cur = getAttr(tplComp, "currentstate") ?? getAttr(tplComp, "defaultstate");
  if (cur) {
    const found = states.find((s) => guidOf(s) === cur);
    if (found) return found;
  }
  return states.find((s) => getAttr(s, "name") === "active") ?? states[0];
}

function num(el: RawElement, key: string): number | undefined {
  const v = getAttr(el, key);
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

/** Resolve an instance's layers against a specific template component (its geometry +
 *  componentimages, with the instance's `override_images` swapped in positionally). */
export function resolveAgainst(comp: RawElement, tplComp: RawElement): ResolvedTemplate {
  const [dw, dh] = parseVec2(getAttr(comp, "dimensions"), [0, 0]);

  const state = templateActiveState(tplComp);
  if (!state) return { width: dw, height: dh, layers: [] };

  // Template componentimages, in declaration order (index == override slot).
  const tplImages = componentImages(tplComp);
  const overrides = overrideImages(comp);

  const metrics = elementChildren(state).find((c) => c.tag === "imagemetrics");
  const layers: ResolvedLayer[] = [];
  if (metrics) {
    for (const img of elementChildren(metrics)) {
      if (img.tag !== "image") continue;
      const ciGuid = getAttr(img, "componentimage");
      if (!ciGuid) continue;
      const slot = tplImages.findIndex((ci) => guidOf(ci) === ciGuid);
      if (slot < 0) continue;
      const imagepath =
        (slot < overrides.length && overrides[slot]) ||
        getAttr(tplImages[slot], "imagepath") ||
        "";
      if (!imagepath) continue;
      layers.push({
        imagepath,
        width: num(img, "width"),
        height: num(img, "height"),
        dockpoint: getAttr(img, "dockpoint"),
        offset: getAttr(img, "offset"),
        colour: getAttr(img, "colour"),
      });
    }
  }

  return { width: dw, height: dh, layers };
}

/** id -> component for a template document (to match a part_of_template child by id). */
export function templateIdMap(tplDoc: TwuiDocument): Map<string, RawElement> {
  const m = new Map<string, RawElement>();
  const comps = childByTag(tplDoc.root, "components");
  if (comps) {
    for (const c of elementChildren(comps)) {
      const id = getAttr(c, "id");
      if (id && !m.has(id)) m.set(id, c);
    }
  }
  return m;
}

export function resolveTemplated(
  comp: RawElement,
  templates: Record<string, TwuiDocument>
): ResolvedTemplate | undefined {
  const templateId = getAttr(comp, "template_id");
  if (!templateId) return undefined;
  const tplDoc = templates[templateId];
  if (!tplDoc) return undefined;
  const tplComp = templateComponent(tplDoc, templateId);
  if (!tplComp) return undefined;
  return resolveAgainst(comp, tplComp);
}
