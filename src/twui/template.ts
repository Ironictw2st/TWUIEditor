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

/** Layouts at this `version` or newer resolve parent-determined icons
 *  (`ParentContext.ImagePath`) and show override_images in the clean view.
 *  Older files are left untouched to avoid regressions. */
export const MIN_PARENT_IMAGE_VERSION = 142;

/** The instance's ordered override image paths (normalised to forward slashes). */
export function overrideImages(comp: RawElement): string[] {
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
export function resolveAgainst(
  comp: RawElement,
  tplComp: RawElement,
  slot0Override?: string
): ResolvedTemplate {
  const [dw, dh] = parseVec2(getAttr(comp, "dimensions"), [0, 0]);

  const state = templateActiveState(tplComp);
  if (!state) return { width: dw, height: dh, layers: [] };

  // Template componentimages, in declaration order (index == override slot).
  const tplImages = componentImages(tplComp);
  const overrides = overrideImages(comp);

  // The template is authored at its component's design size (the active state's w/h); the
  // instance renders at `dimensions`, so scale each layer's size+offset by dimensions/design.
  // When the template has no state size, the layer fills the instance box (its images are
  // sized only by their source art, which must not render at natural pixels in a small box).
  const sw = num(state, "width");
  const sh = num(state, "height");
  const scaleX = dw > 0 && sw ? dw / sw : null;
  const scaleY = dh > 0 && sh ? dh / sh : null;

  const metrics = elementChildren(state).find((c) => c.tag === "imagemetrics");
  const layers: ResolvedLayer[] = [];
  if (metrics) {
    for (const img of elementChildren(metrics)) {
      if (img.tag !== "image") continue;
      const ciGuid = getAttr(img, "componentimage");
      if (!ciGuid) continue;
      const slot = tplImages.findIndex((ci) => guidOf(ci) === ciGuid);
      if (slot < 0) continue;
      // A resolved ContextImageSetter swaps the slot-0 component image (the placeholder
      // icon) wherever it is drawn — matching the non-templated imagesFor behaviour.
      const imagepath =
        (slot === 0 && slot0Override) ||
        (slot < overrides.length && overrides[slot]) ||
        getAttr(tplImages[slot], "imagepath") ||
        "";
      if (!imagepath) continue;
      // Layer size: imagemetric, else the componentimage's, scaled to the instance.
      const rawW = num(img, "width") ?? num(tplImages[slot], "width");
      const rawH = num(img, "height") ?? num(tplImages[slot], "height");
      const width = scaleX != null && rawW != null ? rawW * scaleX : dw > 0 ? dw : rawW;
      const height = scaleY != null && rawH != null ? rawH * scaleY : dh > 0 ? dh : rawH;
      let offset = getAttr(img, "offset");
      if (offset && (scaleX != null || scaleY != null)) {
        const [ox, oy] = parseVec2(offset, [0, 0]);
        offset = `${ox * (scaleX ?? 1)},${oy * (scaleY ?? 1)}`;
      }
      layers.push({
        imagepath,
        width,
        height,
        dockpoint: getAttr(img, "dockpoint"),
        offset,
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
  templates: Record<string, TwuiDocument>,
  slot0Override?: string
): ResolvedTemplate | undefined {
  const templateId = getAttr(comp, "template_id");
  if (!templateId) return undefined;
  const tplDoc = templates[templateId];
  if (!tplDoc) return undefined;
  const tplComp = templateComponent(tplDoc, templateId);
  if (!tplComp) return undefined;
  return resolveAgainst(comp, tplComp, slot0Override);
}

/** The component's ordered component-image paths BY SLOT (not draw order): the
 *  `override_images` values, else `component_image_uniqueguids` names, else the inline
 *  `<componentimages>` imagepaths. Slot N is what `ParentContext.ImagePath(N)` indexes.
 *  Positions are preserved (empty entries kept) so indices stay aligned. */
export function componentImagePaths(comp: RawElement): string[] {
  const ov = overrideImages(comp);
  if (ov.length) return ov;
  return componentImages(comp).map((ci) => normalizeSlashes(getAttr(ci, "imagepath") ?? ""));
}

export interface EffectiveImage {
  imagepath: string;
  width?: number;
  height?: number;
}

/** The effective, ordered images of a component for DISPLAY (canvas + inspector):
 *  - templated     -> override_images positionally over the template's componentimages
 *                     (paths + sizes), falling back to the raw override_images list when
 *                     the template isn't loaded so the paths still surface.
 *  - non-templated -> its own <componentimages> (imagepath + width/height).
 *  When `slot0Override` is set (a resolved ContextImageSetter, incl. ParentContext.ImagePath)
 *  it replaces slot 0's path, keeping its size, creating slot 0 when the list is empty.
 *  Empty paths are dropped. */
export function effectiveImages(
  comp: RawElement,
  templates: Record<string, TwuiDocument>,
  tplComp?: RawElement,
  slot0Override?: string
): EffectiveImage[] {
  if (isTemplated(comp)) {
    // The override is applied at slot 0 INSIDE the resolver (where the slot index is
    // known), so it lands on the right drawn layer regardless of draw order.
    const r =
      resolveTemplated(comp, templates, slot0Override) ??
      (tplComp ? resolveAgainst(comp, tplComp, slot0Override) : undefined);
    if (r && r.layers.length) {
      return r.layers.map((l) => ({ imagepath: l.imagepath, width: l.width, height: l.height }));
    }
    // Template not loaded: the raw override list is already slot-ordered, so apply the
    // slot-0 override here.
    const paths = overrideImages(comp).filter((p) => p.length);
    return applySlot0(paths.map((p) => ({ imagepath: p })), slot0Override);
  }
  // Non-templated <componentimages> are slot-ordered too.
  const own = componentImages(comp)
    .map((ci) => ({ imagepath: getAttr(ci, "imagepath") ?? "", width: num(ci, "width"), height: num(ci, "height") }))
    .filter((e) => e.imagepath.length);
  return applySlot0(own, slot0Override);
}

function applySlot0(out: EffectiveImage[], slot0Override?: string): EffectiveImage[] {
  if (!slot0Override) return out;
  if (!out.length) return [{ imagepath: slot0Override }];
  return out.map((e, i) => (i === 0 ? { ...e, imagepath: slot0Override } : e));
}
