// Compute absolute rectangles for every component by walking the hierarchy and
// combining docking + offset + anchor (or a LayoutEngine's auto-stacking).
//
// The docking math is calibrated so the checkbox label (docking "Center Right
// External", anchor 0,0.5, offset 24,-3) lands just right of the 24px box.
// External docking is treated like its non-external edge for positioning v1
// (the anchor/offset already place the child outside); refine later if needed.

import { CcoShorthand, MinisterialPosition, RawElement, TwuiDocument, FactionContext } from "../types/twui";
import {
  activeState,
  childByTag,
  componentImages,
  componentMap,
  componentStates,
  elementChildren,
  getAttr,
  getLayoutEngine,
  guidOf,
  hierarchyRoot,
  parseVec2,
} from "../twui/doc";
import { ContextTokens } from "../twui/context";
import { isComponentVisible } from "../twui/visibility";
import { postTitle } from "../twui/posts";
import { isTemplated, ResolvedLayer, resolveAgainst, resolveTemplated, templateIdMap } from "../twui/template";
import { LuaValue } from "../twui/lua";
import {
  callbacks,
  decodeEntities,
  evalExpr,
  evalImageSetter,
  evalTextLabel,
  isScriptValueList,
  listSource,
  propagate,
  resolveInlineTokens,
  Scope,
  scriptNodes,
  toEntries,
} from "../twui/cco";
import { cqiRoleOf, portraitImagePath } from "../twui/players";
import { RECORD_LOC, recordKeyFor } from "../twui/records";
import { resolveTooltip } from "../twui/tooltip";
import { componentCreatorLayout } from "../twui/creator";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawImage {
  imagepath: string;
  colour?: string;
  /** The component rect the image anchors within. */
  box: Rect;
  /** Dockpoint fractions (0/0.5/1) within the box. */
  hf: number;
  vf: number;
  /** Pixel offset. */
  ox: number;
  oy: number;
  /** Explicit size; when undefined the image draws at its natural pixel size. */
  w?: number;
  h?: number;
  /** Nine-patch slice margins (left, top, right, bottom) in source pixels — when set,
   *  the image draws as a 9-slice border (corners 1:1, edges/center stretched). */
  margin?: [number, number, number, number];
}

/** Anchor a single line of text within a rect, given edge insets + alignment. Baseline
 *  is "middle". `inset` is { left, right, top, bottom } (from textxoffset/textyoffset). */
export function textAnchor(
  rect: Rect,
  inset: { left: number; right: number; top: number; bottom: number } | undefined,
  hAlign: string | undefined,
  vAlign: string | undefined,
  fontSize: number
): { tx: number; ty: number; align: CanvasTextAlign } {
  const l = inset?.left ?? 0;
  const r = inset?.right ?? 0;
  const t = inset?.top ?? 0;
  const b = inset?.bottom ?? 0;
  const align: CanvasTextAlign = hAlign === "Center" ? "center" : hAlign === "Right" ? "right" : "left";
  const tx =
    hAlign === "Center"
      ? rect.x + (l + (rect.w - r)) / 2
      : hAlign === "Right"
        ? rect.x + rect.w - r
        : rect.x + l;
  const ty =
    vAlign === "Top"
      ? rect.y + t + fontSize / 2
      : vAlign === "Bottom"
        ? rect.y + rect.h - b - fontSize / 2
        : rect.y + (t + (rect.h - b)) / 2;
  return { tx, ty, align };
}

/** Final draw rect for an image, using its natural size when no explicit size was given. */
export function imageDrawRect(di: DrawImage, naturalW: number, naturalH: number): Rect {
  const w = di.w ?? (naturalW || di.box.w);
  const h = di.h ?? (naturalH || di.box.h);
  return {
    x: di.box.x + di.hf * di.box.w - di.hf * w + di.ox,
    y: di.box.y + di.vf * di.box.h - di.vf * h + di.oy,
    w,
    h,
  };
}

/** Parse a `margin="l,t,r,b"` attribute into a non-zero 4-tuple, or undefined. */
export function parseMargin(v: string | undefined): [number, number, number, number] | undefined {
  if (!v) return undefined;
  const n = v.split(",").map((s) => parseFloat(s.trim()));
  if (n.length < 4 || n.some((x) => isNaN(x))) return undefined;
  const m: [number, number, number, number] = [n[0], n[1], n[2], n[3]];
  return m.some((x) => x !== 0) ? m : undefined;
}

/** Nine-patch regions: split the source texture and `dest` rect into a 3x3 grid where
 *  corners are 1:1 (margin px) and the edges/center stretch. `m` = (left, top, right, bottom). */
export function nineSliceRegions(
  dest: Rect,
  srcW: number,
  srcH: number,
  m: [number, number, number, number]
): { src: Rect; dst: Rect }[] {
  // Clamp corners so they never exceed the source or destination extents.
  const ml = Math.min(m[0], srcW, dest.w);
  const mt = Math.min(m[1], srcH, dest.h);
  const mr = Math.min(m[2], srcW - ml, dest.w - ml);
  const mb = Math.min(m[3], srcH - mt, dest.h - mt);
  const sCols = [
    { o: 0, w: ml },
    { o: ml, w: srcW - ml - mr },
    { o: srcW - mr, w: mr },
  ];
  const sRows = [
    { o: 0, h: mt },
    { o: mt, h: srcH - mt - mb },
    { o: srcH - mb, h: mb },
  ];
  const dCols = [
    { o: dest.x, w: ml },
    { o: dest.x + ml, w: dest.w - ml - mr },
    { o: dest.x + dest.w - mr, w: mr },
  ];
  const dRows = [
    { o: dest.y, h: mt },
    { o: dest.y + mt, h: dest.h - mt - mb },
    { o: dest.y + dest.h - mb, h: mb },
  ];
  const out: { src: Rect; dst: Rect }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (sCols[c].w <= 0 || sRows[r].h <= 0 || dCols[c].w <= 0 || dRows[r].h <= 0) continue;
      out.push({
        src: { x: sCols[c].o, y: sRows[r].o, w: sCols[c].w, h: sRows[r].h },
        dst: { x: dCols[c].o, y: dRows[r].o, w: dCols[c].w, h: dRows[r].h },
      });
    }
  }
  return out;
}

/** Rough text width for `sizetocontent` layout (the pure layout pass has no DOM metrics).
 *  `{{…}}` tokens collapse to ~2 chars; `length * fontSize * 0.5` approximates the advance. */
export function estimateTextWidth(text: string, fontSize: number): number {
  const plain = text.replace(/\{\{[\s\S]*?\}\}/g, "00");
  return plain.length * fontSize * 0.5;
}

export interface RenderItem {
  guid: string;
  tag: string;
  rect: Rect;
  priority: number;
  visible: boolean;
  depth: number;
  clip?: Rect;
  text?: string;
  fontColour?: string;
  fontSize?: number;
  fontName?: string;
  textHAlign?: string;
  textVAlign?: string;
  /** Text insets from the rect edges: `textxoffset`=(left,right), `textyoffset`=(top,bottom).
   *  Defines the box the text is aligned within (clears icons on either side). */
  textInset?: { left: number; right: number; top: number; bottom: number };
  images: DrawImage[];
  /** Resolved tooltip text (only populated in Tooltip mode). */
  tooltip?: string;
}

/** A clipped, overflowing list that the user can scroll in Simulation mode. */
export interface Scrollable {
  guid: string;
  clip: Rect;
  contentHeight: number;
  viewHeight: number;
}

/** Simulation-mode state: scroll offsets, forced states, visibility overrides. */
export interface Sim {
  scroll: Record<string, number>;
  state: Record<string, string>;
  show: string[];
  hide: string[];
}

/** A rendered slider (vslider/hslider) wired to the scrollable it controls.
 *  In Simulation mode its handle is the draggable thumb; the synthetic scrollbar
 *  overlay is suppressed for the linked viewport. Vertical only for now. */
export interface SliderLink {
  viewportGuid: string;
  sliderGuid: string;
  handleGuid?: string;
  axis: "v";
  track: Rect;
}

export interface LayoutResult {
  items: RenderItem[];
  canvas: Rect;
  scrollables: Scrollable[];
  sliderLinks: SliderLink[];
}

function num(el: RawElement | undefined, key: string, fallback: number): number {
  if (!el) return fallback;
  const v = getAttr(el, key);
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function numOpt(el: RawElement, key: string): number | undefined {
  const v = getAttr(el, key);
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

interface DockInfo {
  hf: number;
  vf: number;
  extAxis: "h" | "v" | null;
}

function dockInfo(docking: string | undefined): DockInfo {
  if (!docking || docking === "None") return { hf: 0, vf: 0, extAxis: null };
  const hf = /Right/.test(docking) ? 1 : /Left/.test(docking) ? 0 : /Center/.test(docking) ? 0.5 : 0;
  const vf = /Bottom/.test(docking) ? 1 : /Top/.test(docking) ? 0 : /Center/.test(docking) ? 0.5 : 0;
  let extAxis: "h" | "v" | null = null;
  if (/External/.test(docking)) {
    if (/Left|Right/.test(docking)) extAxis = "h";
    else if (/Top|Bottom/.test(docking)) extAxis = "v";
  }
  return { hf, vf, extAxis };
}

// Plain docking fractions (for image dockpoints, which never go External).
function dockFrac(docking: string | undefined): [number, number] {
  const { hf, vf } = dockInfo(docking);
  return [hf, vf];
}

/** Resize-aware size: when the parent is rendered larger/smaller than its authored
 *  (design) size, a child grows by the same delta on each axis unless it opts out via
 *  `allowhorizontalresize`/`allowverticalresize="false"` (the game's resize flags).
 *  Templated widgets keep their authored pixel size. When parentActual == parentDesign
 *  (the default resolution), this returns `designChild` unchanged. */
function resolveSize(
  comp: RawElement,
  designChild: { w: number; h: number },
  parentActual: Rect,
  parentDesign: { w: number; h: number }
): { w: number; h: number } {
  if (isTemplated(comp)) return designChild;
  const dW = parentActual.w - parentDesign.w;
  const dH = parentActual.h - parentDesign.h;
  const hResize = getAttr(comp, "allowhorizontalresize") !== "false";
  const vResize = getAttr(comp, "allowverticalresize") !== "false";
  return {
    w: hResize ? designChild.w + dW : designChild.w,
    h: vResize ? designChild.h + dH : designChild.h,
  };
}

/** Resolution-aware port of `positionChild`. Identical to `positionChild` when the
 *  parent renders at its design size and the child isn't grown; otherwise it re-applies
 *  the docking term against the ACTUAL parent/child sizes. The baked `offset` (authored
 *  at design res) is split back into its docking term + dock_offset nudge so the nudge is
 *  preserved while the docking term tracks the real parent size — letting edge-docked
 *  panels follow the screen edges at other resolutions. */
function positionChildRes(
  parent: Rect,
  parentDesign: { w: number; h: number },
  comp: RawElement,
  w: number,
  h: number,
  designChild: { w: number; h: number }
): Rect {
  const docking = getAttr(comp, "docking");
  const dockPoint = getAttr(comp, "dock_point");
  const offsetAttr = getAttr(comp, "offset");
  const [ox, oy] = parseVec2(offsetAttr, [0, 0]);

  // Templated instances: `offset` is a nudge relative to the dock anchor (see positionChild).
  if (docking === undefined && dockPoint !== undefined) {
    const { hf, vf, extAxis } = dockInfo(dockPoint);
    const defAx = extAxis === "h" ? 1 - hf : hf;
    const defAy = extAxis === "v" ? 1 - vf : vf;
    const [ax, ay] = parseVec2(getAttr(comp, "component_anchor_point"), [defAx, defAy]);
    return { x: parent.x + hf * parent.w - ax * w + ox, y: parent.y + vf * parent.h - ay * h + oy, w, h };
  }

  // Regular component with a baked `offset`: recover the dock_offset nudge at design res
  // (offset − dockingTerm(designParent, designChild)) and re-apply the docking term against
  // the actual sizes. Reduces exactly to `parent + offset` when actual == design.
  if (offsetAttr !== undefined) {
    const { hf, vf, extAxis } = dockInfo(docking);
    const defAx = extAxis === "h" ? 1 - hf : hf;
    const defAy = extAxis === "v" ? 1 - vf : vf;
    const [ax, ay] = parseVec2(getAttr(comp, "component_anchor_point"), [defAx, defAy]);
    const dockOffX = ox - (hf * parentDesign.w - ax * designChild.w);
    const dockOffY = oy - (vf * parentDesign.h - ay * designChild.h);
    return {
      x: parent.x + hf * parent.w - ax * w + dockOffX,
      y: parent.y + vf * parent.h - ay * h + dockOffY,
      w,
      h,
    };
  }

  // No offset: pure docking + anchor against the actual parent/child sizes.
  const { hf, vf, extAxis } = dockInfo(docking);
  const defAx = extAxis === "h" ? 1 - hf : hf;
  const defAy = extAxis === "v" ? 1 - vf : vf;
  const [ax, ay] = parseVec2(getAttr(comp, "component_anchor_point"), [defAx, defAy]);
  return { x: parent.x + hf * parent.w - ax * w, y: parent.y + vf * parent.h - ay * h, w, h };
}

type Templates = Record<string, TwuiDocument>;

/** Real text measurement (canvas metrics), injected by the visualizer so `sizetocontent`
 *  widths match the drawn font. Absent in headless layout -> estimateTextWidth fallback. */
export type MeasureText = (text: string, fontName: string | undefined, sizePx: number) => number;
let activeMeasureText: MeasureText | undefined;

/** Slider axis if the component is a vslider/hslider (by its VSlider/HSlider callback). */
function sliderAxis(comp: RawElement): "v" | "h" | null {
  for (const cb of callbacks(comp)) {
    if (cb.id === "VSlider") return "v";
    if (cb.id === "HSlider") return "h";
  }
  return null;
}

/** True if the component is a slider's draggable handle (VSliderHandle/HSliderHandle). */
function isSliderHandle(comp: RawElement): boolean {
  return callbacks(comp).some((cb) => cb.id === "VSliderHandle" || cb.id === "HSliderHandle");
}

/** Size of a component: templated -> `dimensions`; else the active state w/h. */
function sizeFor(
  comp: RawElement,
  state: RawElement | undefined,
  parent: Rect,
  _templates: Templates
): { w: number; h: number } {
  if (isTemplated(comp)) {
    // Always size from `dimensions` so a missing template doesn't balloon to parent size.
    const [dw, dh] = parseVec2(getAttr(comp, "dimensions"), [0, 0]);
    // A slider's track spans the parent on its long axis so it lines up with the
    // list it scrolls: vslider height -> parent.h, hslider width -> parent.w.
    const axis = sliderAxis(comp);
    if (axis === "v") return { w: dw, h: parent.h };
    if (axis === "h") return { w: parent.w, h: dh };
    return { w: dw, h: dh };
  }
  return { w: num(state, "width", parent.w), h: num(state, "height", parent.h) };
}

/** Position resolved template layers within the component rect. */
function layerImages(layers: ResolvedLayer[], rect: Rect): DrawImage[] {
  return layers.map((l) => {
    const [hf, vf] = dockFrac(l.dockpoint);
    const [ox, oy] = parseVec2(l.offset, [0, 0]);
    return {
      imagepath: l.imagepath,
      colour: l.colour,
      box: rect,
      hf,
      vf,
      ox,
      oy,
      w: l.width,
      h: l.height,
    };
  });
}

/** Images for a component: templated -> resolved layers; else inline imagemetrics.
 *  `iconOverride` swaps the slot-0 component_image's path (a resolved ContextImageSetter). */
function imagesForComp(
  comp: RawElement,
  state: RawElement | undefined,
  rect: Rect,
  templates: Templates,
  tplCompMap: Map<string, RawElement>,
  iconOverride?: string
): DrawImage[] {
  if (isTemplated(comp)) {
    // Own `template_id`, else (a part_of_template child) the ancestor template's
    // matching component, looked up by id during the pre-walk.
    let r = resolveTemplated(comp, templates);
    if (!r) {
      const tc = tplCompMap.get(guidOf(comp) ?? "");
      if (tc) r = resolveAgainst(comp, tc);
    }
    if (r) return layerImages(r.layers, rect);
    return [];
  }
  return imagesFor(comp, state, rect, iconOverride);
}

/** A callback element's raw children across both callback containers. */
function rawCallbacks(comp: RawElement): RawElement[] {
  const out: RawElement[] = [];
  for (const tag of ["callbackwithcontextlist", "callbacks_with_context"]) {
    const list = childByTag(comp, tag);
    if (list) for (const cb of elementChildren(list)) if (cb.tag === "callback_with_context") out.push(cb);
  }
  return out;
}

/**
 * Resolve the composite portrait for a `Character2DDisplayCreator` component:
 * its sibling `ContextPropagator` funcId evaluates (in scope) to an `ArtContext`
 * record carrying a `portrait` folder; `character_size_type` picks the still.
 * Returns null when no creator / unassigned role / unresolved art.
 */
function characterPortrait(comp: RawElement, scope: Scope): string | null {
  const cbs = rawCallbacks(comp);
  const creator = cbs.find((c) => getAttr(c, "callback_id") === "Character2DDisplayCreator");
  if (!creator) return null;
  // character_size_type from the creator's child_m_user_properties.
  let sizeType = "large_panel";
  const props = childByTag(creator, "child_m_user_properties");
  if (props) {
    for (const p of elementChildren(props)) {
      if (getAttr(p, "name") === "character_size_type" && getAttr(p, "value")) {
        sizeType = getAttr(p, "value")!;
      }
    }
  }
  // The art context comes from a ContextPropagator on the same component.
  const prop = cbs.find((c) => getAttr(c, "callback_id") === "ContextPropagator");
  const fn = prop ? decodeEntities(getAttr(prop, "context_function_id") ?? "") : "";
  if (!fn) return null;

  // 1) PlayersFaction roles (incl. GetIfElse leader/heir) resolve via the evaluator.
  const art = evalExpr(fn, scope);
  let portrait =
    art && typeof art === "object" && !Array.isArray(art) ? (art as Record<string, unknown>).portrait : undefined;

  // 2) CQI roles (`CharactersForCQIs(TableValue.ValueForKey("KEY"))`) resolve from the
  // assigned-character art map injected into scope vars (`__roleArt[key].portrait`).
  if (typeof portrait !== "string" || !portrait) {
    const key = cqiRoleOf(fn);
    const map = scope.vars.__roleArt;
    if (key && map && typeof map === "object" && !Array.isArray(map)) {
      const art = (map as Record<string, unknown>)[key];
      const v = art && typeof art === "object" ? (art as Record<string, unknown>).portrait : undefined;
      if (typeof v === "string") portrait = v;
    }
  }

  if (typeof portrait !== "string" || !portrait) return null;
  return portraitImagePath(portrait, sizeType);
}

function intersectRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

function imagesFor(
  comp: RawElement,
  state: RawElement | undefined,
  rect: Rect,
  iconOverride?: string
): DrawImage[] {
  if (!state) return [];
  const metrics = state.children.filter(
    (c): c is RawElement => c.kind === "element" && c.tag === "imagemetrics"
  )[0];
  if (!metrics) return [];

  const pathByGuid = new Map<string, string>();
  const sizeByGuid = new Map<string, { w?: number; h?: number }>();
  // A resolved ContextImageSetter overrides component_image SLOT 0 — keep its
  // imagemetric geometry, only swap the path (even if the static path is empty).
  const ci0 = componentImages(comp)[0];
  const slot0 = ci0 ? guidOf(ci0) : undefined;
  for (const ci of componentImages(comp)) {
    const g = guidOf(ci);
    const p = getAttr(ci, "imagepath");
    if (!g) continue;
    if (p) pathByGuid.set(g, p);
    sizeByGuid.set(g, { w: numOpt(ci, "width"), h: numOpt(ci, "height") });
  }
  if (iconOverride && slot0) pathByGuid.set(slot0, iconOverride);

  const out: DrawImage[] = [];
  for (const img of elementChildren(metrics)) {
    if (img.tag !== "image") continue;
    const ciGuid = getAttr(img, "componentimage");
    if (!ciGuid) continue;
    const imagepath = pathByGuid.get(ciGuid);
    if (!imagepath) continue;
    const ciSize = sizeByGuid.get(ciGuid) ?? {};
    const [hf, vf] = dockFrac(getAttr(img, "dockpoint"));
    const [ox, oy] = parseVec2(getAttr(img, "offset"), [0, 0]);
    out.push({
      imagepath,
      colour: getAttr(img, "colour"),
      box: rect,
      hf,
      vf,
      ox,
      oy,
      // Size precedence: image metric -> component_image -> natural (at draw).
      w: numOpt(img, "width") ?? ciSize.w,
      h: numOpt(img, "height") ?? ciSize.h,
      margin: parseMargin(getAttr(img, "margin")),
    });
  }
  return out;
}

export function computeLayout(
  doc: TwuiDocument,
  ctx?: FactionContext,
  tokens?: ContextTokens,
  templates: Templates = {},
  loc?: Record<string, string>,
  dataPack?: LuaValue | null,
  sim?: Sim,
  staticVars?: Record<string, LuaValue>,
  resolveTooltips?: boolean,
  created: Record<string, TwuiDocument> = {},
  ccoShorthand?: CcoShorthand | null,
  componentDataPacks: Record<string, LuaValue> = {},
  measureText?: MeasureText,
  posts?: MinisterialPosition[],
  renderResolution?: { w: number; h: number } | null
): LayoutResult {
  activeMeasureText = measureText;
  const items: RenderItem[] = [];
  const scrollables: Scrollable[] = [];
  const sliderLinks: SliderLink[] = [];
  const root = hierarchyRoot(doc);
  const cmap = componentMap(doc);
  if (!root) return { items, canvas: { x: 0, y: 0, w: 1920, h: 1080 }, scrollables, sliderLinks };

  // Map each `part_of_template` instance (which has no inline states/images) to the
  // matching component (by id) in its nearest `template_id` ancestor's template, so its
  // visuals resolve. Built across the main doc + every embedded sub-layout (guids are global).
  const tplCompMap = new Map<string, RawElement>();
  const idMapCache = new Map<TwuiDocument, Map<string, RawElement>>();
  const idMapOf = (d: TwuiDocument) => {
    let m = idMapCache.get(d);
    if (!m) { m = templateIdMap(d); idMapCache.set(d, m); }
    return m;
  };
  const buildTplMap = (d: TwuiDocument) => {
    const dcmap = componentMap(d);
    const droot = hierarchyRoot(d);
    if (!droot) return;
    const walk = (node: RawElement, idMap: Map<string, RawElement> | undefined) => {
      const comp = dcmap.get(guidOf(node) ?? "");
      let childMap = idMap;
      if (comp) {
        const tid = getAttr(comp, "template_id");
        if (tid && templates[tid]) {
          childMap = idMapOf(templates[tid]);
        } else if (idMap && getAttr(comp, "part_of_template") === "true") {
          const id = getAttr(comp, "id");
          const tc = id ? idMap.get(id) : undefined;
          if (tc) tplCompMap.set(guidOf(comp) ?? "", tc);
        }
      }
      for (const c of elementChildren(node)) walk(c, childMap);
    };
    walk(droot, undefined);
  };
  buildTplMap(doc);
  for (const sub of Object.values(created)) buildTplMap(sub);

  const rootComp = cmap.get(guidOf(root) ?? "");
  const rootState = rootComp ? activeState(rootComp) : undefined;
  // The root's authored state size is the design resolution; the canvas renders at the
  // chosen target resolution (or the design size when unset). Components reflow against the
  // delta between the two (see resolveSize/positionChildRes) — at the design size it's a no-op.
  const rootDesign = { w: num(rootState, "width", 1920), h: num(rootState, "height", 1080) };
  const canvas: Rect = {
    x: 0,
    y: 0,
    w: renderResolution?.w ?? rootDesign.w,
    h: renderResolution?.h ?? rootDesign.h,
  };

  // Root binding scope: the connected script's data pack drives list population
  // and script-condition visibility; `staticVars` supplies DB-record contexts
  // (e.g. PlayersFaction). Per-row scopes branch from this.
  const rootScope: Scope = {
    dataPack: dataPack ?? null,
    vars: { ...staticVars },
    shorthand: ccoShorthand ?? undefined,
  };

  // Pick the rendered state: a Simulation forced state (click feedback) wins,
  // else current/default/active.
  const stateFor = (comp: RawElement): RawElement | undefined => {
    const g = guidOf(comp);
    const forced = g ? sim?.state[g] : undefined;
    if (forced) {
      const s = componentStates(comp).find((st) => getAttr(st, "name") === forced);
      if (s) return s;
    }
    return activeState(comp);
  };

  // Visibility decision: Simulation override, then script condition (data pack),
  // then campaign gate, then faction/subculture filter, then static flag.
  const shouldRender = (
    comp: RawElement,
    state: RawElement | undefined,
    scope: Scope
  ): boolean => isComponentVisible(comp, state, scope, ctx, tokens, sim);

  const pushItem = (
    hierNode: RawElement,
    comp: RawElement,
    state: RawElement | undefined,
    rect: Rect,
    parentRect: Rect,
    depth: number,
    clip: Rect | null,
    scope: Scope,
    cmap: Map<string, RawElement>,
    lDoc: TwuiDocument
  ) => {
    // Data binding: ContextImageSetter / ContextTextLabel resolve the icon/text
    // from script/static context. They return null when unresolved, so static
    // placeholders survive — which is why this runs for every component (list rows
    // via `scope.entry`, page-level via `scope.vars`, e.g. `ToUpper(PlayersFaction.Name)`).
    const cbs = callbacks(comp);

    // A resolved ContextImageSetter overrides the component's slot-0 image (the
    // placeholder icon) at the placeholder's imagemetric geometry — NOT the whole
    // rect. Unresolved → no override → the static placeholder shows.
    const isCb = cbs.find((c) => c.id === "ContextImageSetter");
    const iconOverride = isCb?.funcId ? evalImageSetter(isCb.funcId, scope) ?? undefined : undefined;

    const images = imagesForComp(comp, state, rect, templates, tplCompMap, iconOverride);
    // Fallback: the override resolved but the component has no slot-0 imagemetric
    // to carry it (a placeholder-less dynamic icon) — draw it at the slot-0
    // component_image size, else the rect.
    if (iconOverride && !images.some((i) => i.imagepath === iconOverride)) {
      const ci0 = componentImages(comp)[0];
      const w = ci0 ? numOpt(ci0, "width") : undefined;
      const h = ci0 ? numOpt(ci0, "height") : undefined;
      images.push({ imagepath: iconOverride, box: rect, hf: 0, vf: 0, ox: 0, oy: 0, w: w ?? rect.w, h: h ?? rect.h });
    }

    // Raw attribute values are XML-escaped for round-trip; decode for display.
    let text = state ? getAttr(state, "text") : undefined;
    if (text) text = decodeEntities(text);

    // ContextTextLabel. For a DB-record context (CcoEffectBundle / pooled
    // resource / ceo set / effect) the display text comes from the .loc files:
    // resolve the record's key, look up each property the registry knows, and
    // inject the strings as vars so the funcId (`ToUpper(Name)`, `Description`, …)
    // resolves against them. Unresolved -> null -> the static `dy_` text is kept.
    const tlCb = cbs.find((c) => c.id === "ContextTextLabel");
    if (tlCb?.funcId) {
      let s = scope;
      const reg = tlCb.objectId ? RECORD_LOC[tlCb.objectId] : undefined;
      if (reg) {
        const key = recordKeyFor(tlCb.objectId!, scope, lDoc, guidOf(hierNode) ?? "", cmap);
        if (key) {
          const vars: Record<string, LuaValue> = {};
          for (const [prop, prefix] of Object.entries(reg)) {
            const v = loc?.[prefix + key];
            if (v !== undefined) vars[prop] = v;
          }
          if (Object.keys(vars).length) s = { ...scope, vars: { ...scope.vars, ...vars } };
        }
      } else if (tlCb.objectId === "CcoCampaignCharacterPost" && typeof s.vars.__postKey === "string") {
        // Court office label: resolve `Name` to the post's title (from the ministerial
        // positions table) so `ToUpper(Name)` renders the office, not the `dy_` default.
        const title = postTitle(s.vars.__postKey, ctx, posts, loc);
        if (title !== undefined) s = { ...scope, vars: { ...scope.vars, Name: title } };
      }
      const t = evalTextLabel(tlCb.funcId, s, loc);
      if (t !== null) text = t;
    }

    // Character portrait: a Character2DDisplayCreator whose role has an assigned
    // character resolves to a composite. The `character` component is a thin anchor
    // (e.g. 50×1100); the real display box is its PARENT container (the art holder,
    // whose aspect matches the composite), so fill `parentRect` — not the anchor
    // rect (stretches) nor natural size (too big). Gated on `cbs` so the per-frame
    // scan only runs for the handful of components that have the creator.
    const portrait = cbs.some((c) => c.id === "Character2DDisplayCreator")
      ? characterPortrait(comp, scope)
      : null;
    if (portrait)
      images.push({
        imagepath: portrait,
        box: parentRect,
        hf: 0,
        vf: 0,
        ox: 0,
        oy: 0,
        w: parentRect.w,
        h: parentRect.h,
      });

    // Resolve inline {{CcoScriptObject/CcoScriptTableNode:…}} tokens embedded in
    // the text (e.g. "COMPLETE: {{…Size}}/8"); strips {{tt:…}} tooltip refs.
    if (text && text.includes("{{")) text = resolveInlineTokens(text, scope, loc);

    // Tooltip mode: resolve the component's tooltip (script setter, else static).
    const tooltip = resolveTooltips ? resolveTooltip(comp, scope, loc) ?? undefined : undefined;

    // Text insets: `textxoffset`=(left,right), `textyoffset`=(top,bottom) — both clear
    // side icons; they are NOT an (x,y) shift (a separate `textyoffset` carries vertical).
    const [insL, insR] = parseVec2(state ? getAttr(state, "textxoffset") : undefined, [0, 0]);
    const [insT, insB] = parseVec2(state ? getAttr(state, "textyoffset") : undefined, [0, 0]);

    items.push({
      guid: guidOf(hierNode) ?? "",
      tag: hierNode.tag,
      rect,
      priority: num(comp, "priority", 0),
      visible: true,
      depth,
      clip: clip ?? undefined,
      text,
      fontColour: state ? getAttr(state, "font_m_colour") : undefined,
      fontSize: state ? num(state, "font_m_size", 13) : undefined,
      fontName: state ? getAttr(state, "font_m_font_name") : undefined,
      textHAlign: state ? getAttr(state, "texthalign") : undefined,
      textVAlign: state ? getAttr(state, "textvalign") : undefined,
      textInset:
        insL || insR || insT || insB
          ? { left: insL, right: insR, top: insT, bottom: insB }
          : undefined,
      images,
      tooltip,
    });
  };

  // Render a visible child, recurse, and return the subtree's max bottom Y.
  // `cmap`/`lDoc` are the CURRENT layout's component map + doc (they switch when a
  // ComponentCreator embeds a sub-layout).
  const emit = (
    child: RawElement,
    comp: RawElement,
    state: RawElement | undefined,
    rect: Rect,
    parentRect: Rect,
    depth: number,
    clip: Rect | null,
    scope: Scope,
    cmap: Map<string, RawElement>,
    lDoc: TwuiDocument,
    childDesign: { w: number; h: number }
  ): number => {
    pushItem(child, comp, state, rect, parentRect, depth, clip, scope, cmap, lDoc);
    const childClip =
      getAttr(comp, "clipchildren") === "true" ? intersectRect(clip, rect) : clip;
    // Pass the child's DESIGN size (not its possibly-grown rect) so a fixed-size panel's
    // subtree renders at design (delta 0) while a resized container's children reflow.
    const sub = recurse(child, rect, depth + 1, childClip, scope, cmap, lDoc, childDesign);
    return Math.max(rect.y + rect.h, sub);
  };

  // Visible element children of a hierarchy node (applies the same propagate + state +
  // visibility filter as recurse), in the given component map. Shared with the content measurer.
  const buildVisible = (
    hierNode: RawElement,
    scope: Scope,
    cm: Map<string, RawElement>
  ): { node: RawElement; comp: RawElement; state?: RawElement; scope: Scope }[] => {
    const out: { node: RawElement; comp: RawElement; state?: RawElement; scope: Scope }[] = [];
    for (const child of elementChildren(hierNode)) {
      const cc = cm.get(guidOf(child) ?? "");
      if (!cc) continue;
      const childScope = propagate(cc, scope);
      const st = stateFor(cc);
      if (!shouldRender(cc, st, childScope)) continue;
      out.push({ node: child, comp: cc, state: st, scope: childScope });
    }
    return out;
  };

  // True content size of a sizetocontent, static-children layout-engine container (bbox of its
  // laid-out children), so a parent positions/centres it by its real extent. Undefined otherwise
  // (parent keeps the state size). Dynamic lists (List/ContextList) are excluded.
  const measureContent = (
    hierNode: RawElement,
    comp: RawElement,
    scope: Scope | undefined,
    cm: Map<string, RawElement> | undefined,
    depth: number
  ): { w: number; h: number } | undefined => {
    if (depth > 6 || !scope || !cm) return undefined;
    const le = getLayoutEngine(comp);
    if (!le || getAttr(le, "sizetocontent") !== "true") return undefined;
    if (callbacks(comp).some((c) => c.id === "List" || c.id === "ContextList")) return undefined;
    const visible = buildVisible(hierNode, scope, cm);
    // A sizetocontent container with no visible children collapses to zero (it has no content),
    // so a parent's LayoutEngine reserves no slot for it — rather than falling back to its state
    // size, which would leave a phantom gap (e.g. an all-hidden dlc_buttons keeping its 490px).
    if (!visible.length) return { w: 0, h: 0 };
    const st = activeState(comp);
    const box = { x: 0, y: 0, w: num(st, "width", 0), h: num(st, "height", 0) };
    const anchored = getAttr(comp, "component_anchor_point") !== undefined;
    const placed = layoutEngine(
      le, visible, box, templates, !anchored,
      (n, c, s, m) => measureContent(n, c, s, m, depth + 1), cm
    );
    if (!placed.length) return undefined;
    return {
      w: Math.max(...placed.map((p) => p.rect.x + p.rect.w)),
      h: Math.max(...placed.map((p) => p.rect.y + p.rect.h)),
    };
  };
  const containerContentSize: ContentSizeFn = (n, c, s, m) => measureContent(n, c, s, m, 0);

  // Returns the max bottom Y of everything emitted under hierNode.
  const recurse = (
    hierNode: RawElement,
    parentRect: Rect,
    depth: number,
    clip: Rect | null,
    scope: Scope,
    cmap: Map<string, RawElement>,
    lDoc: TwuiDocument,
    parentDesign: { w: number; h: number }
  ): number => {
    const comp = cmap.get(guidOf(hierNode) ?? "");
    const children = elementChildren(hierNode);
    const le = comp ? getLayoutEngine(comp) : undefined;

    // A component with its own ContextInitScriptObject publishes its own data pack;
    // switch the subtree's `dataPack` to it (like ComponentCreator switches cmap/lDoc),
    // so a sub-scripted list (e.g. the schemes list_box) resolves its own table.
    const ownPack = comp ? componentDataPacks[guidOf(comp) ?? ""] : undefined;
    if (ownPack !== undefined) scope = { ...scope, dataPack: ownPack };

    // A clipchildren container is a scrollable viewport: shift its children up by
    // the sim scroll offset; the clip stays the (fixed) viewport.
    const isViewport = !!comp && getAttr(comp, "clipchildren") === "true";
    const vpGuid = isViewport ? guidOf(hierNode) : undefined;
    const dy = vpGuid ? sim?.scroll[vpGuid] ?? 0 : 0;
    const origin = dy ? { ...parentRect, y: parentRect.y - dy } : parentRect;

    let maxBottom = parentRect.y;
    const track = (b: number) => {
      if (b > maxBottom) maxBottom = b;
    };
    const finish = (): number => {
      if (vpGuid && clip) {
        const contentHeight = maxBottom - origin.y;
        if (contentHeight > clip.h + 0.5) {
          scrollables.push({ guid: vpGuid, clip, contentHeight, viewHeight: clip.h });
        }
      }
      return maxBottom;
    };

    // ComponentCreator: this box embeds a SEPARATE layout as its content. Render
    // the sub-layout's widget(s) (its design-root's children) at the box origin,
    // recursing with the SUB-layout's component map + doc so its components resolve
    // (and any nested ComponentCreators load). The box's scope flows in; DB contexts
    // inside that can't resolve fall back to static placeholders (frames/locks).
    const createdPath = comp ? componentCreatorLayout(comp) : undefined;
    const sub = createdPath ? created[createdPath] : undefined;
    if (sub) {
      const subRoot = hierarchyRoot(sub);
      const subCmap = componentMap(sub);
      if (subRoot) {
        for (const widget of elementChildren(subRoot)) {
          const wcomp = subCmap.get(guidOf(widget) ?? "");
          if (!wcomp) continue;
          const wscope = propagate(wcomp, scope);
          const st = stateFor(wcomp);
          if (!shouldRender(wcomp, st, wscope)) continue;
          // Anchored at the box's top-left; the widget's own design offset (relative
          // to its 1920×1080 canvas) is irrelevant once embedded.
          const { w, h } = sizeFor(wcomp, st, origin, templates);
          track(
            emit(widget, wcomp, st, { x: origin.x, y: origin.y, w, h }, origin, depth, clip, wscope, subCmap, sub, { w, h })
          );
        }
        return finish();
      }
    }

    // List container: a `List`/`ContextList` callback + one template child. Repeat
    // the child once per data entry. With NO resolvable data the list is EMPTY —
    // render nothing, never the stray prototype. (The child stays in the tree.)
    const listCb = comp ? callbacks(comp).find((c) => c.id === "List" || c.id === "ContextList") : undefined;
    if (listCb && children.length === 1) {
      // With NO resolvable data the list is EMPTY — render nothing, never the stray
      // prototype. (The child stays in the tree.) See `listEntries`.
      const entries = listEntries(comp!, scope);
      const tmpl = children[0];
      const tcomp = cmap.get(guidOf(tmpl) ?? "");
      const tstate = tcomp ? activeState(tcomp) : undefined;
      if (tcomp && entries.length) {
        const instances = entries.map((e) => ({
          node: tmpl,
          comp: tcomp,
          state: tstate,
          scope: propagate(tcomp, { ...scope, entry: e.value, entryKey: e.key, vars: { ...scope.vars } }),
        }));
        if (le) {
          for (const p of layoutEngine(le, instances, origin, templates)) {
            track(emit(p.node, p.comp, p.state, p.rect, origin, depth, clip, p.scope ?? scope, cmap, lDoc, { w: p.rect.w, h: p.rect.h }));
          }
        } else {
          let y = origin.y;
          for (const inst of instances) {
            const { w, h } = sizeFor(inst.comp, inst.state, origin, templates);
            track(emit(inst.node, inst.comp, inst.state, { x: origin.x, y, w, h }, origin, depth, clip, inst.scope, cmap, lDoc, { w, h }));
            y += h;
          }
        }
      }
      return finish();
    }

    // Filter to visible children up front (so layout engines don't reserve
    // space for hidden ones). Apply any ContextPropagator sub-context per child.
    const visible = buildVisible(hierNode, scope, cmap);

    if (le && visible.length) {
      // Anchored containers (e.g. the court `holder`) shrink to content and re-centre per their
      // anchor; non-anchored ones (rows/tiers) honour each static child's cached offset instead.
      const anchored = !!comp && getAttr(comp, "component_anchor_point") !== undefined;
      // When some siblings are script/context-hidden, the survivors' cached offsets no longer pack
      // (they leave gaps), so fall back to cumulative stacking. Fully-visible containers keep
      // honouring offsets — zero behaviour change unless something is actually hidden.
      const renderable = children.filter((c) => cmap.get(guidOf(c) ?? "")).length;
      const hasHidden = visible.length < renderable;
      let placed = layoutEngine(le, visible, origin, templates, !anchored && !hasHidden, containerContentSize, cmap);
      if (comp && anchored) placed = recenterSizeToContent(placed, le, comp, origin);
      for (const p of placed) {
        track(emit(p.node, p.comp, p.state, p.rect, origin, depth, clip, p.scope ?? scope, cmap, lDoc, { w: p.rect.w, h: p.rect.h }));
      }
      return finish();
    }

    // Static children: size at the parent's DESIGN dimensions, then grow per the parent's
    // render-vs-design delta (resolveSize) and position against the actual parent (positionChildRes).
    // At the design resolution these reduce to the old sizeFor/positionChild path exactly.
    const parentDesignRect: Rect = { x: 0, y: 0, w: parentDesign.w, h: parentDesign.h };
    for (const { node, comp: cc, state, scope: cs } of visible) {
      const designChild = sizeFor(cc, state, parentDesignRect, templates);
      const { w, h } = resolveSize(cc, designChild, origin, parentDesign);
      const rect = positionChildRes(origin, parentDesign, cc, w, h, designChild);
      track(emit(node, cc, state, rect, origin, depth, clip, cs, cmap, lDoc, designChild));
    }
    return finish();
  };

  // Root always renders and fills the canvas.
  if (rootComp) {
    pushItem(root, rootComp, rootState, canvas, canvas, 0, null, rootScope, cmap, doc);
    const rootClip = getAttr(rootComp, "clipchildren") === "true" ? canvas : null;
    recurse(root, canvas, 1, rootClip, rootScope, cmap, doc, rootDesign);
  }

  // Wire rendered vsliders to the scrollable they control and turn each slider's
  // handle into the moving thumb. General: a slider controls the clipped, overflowing
  // viewport that shares its hierarchy parent (in `listview -> [list_clip(clipchildren),
  // vslider]` the viewport and the slider are siblings). Vertical only for now.
  const parentOf = new Map<string, string>();
  const sliders: { guid: string; parent: string; axis: "v" | "h"; handle?: string }[] = [];
  const collectSliders = (d: TwuiDocument) => {
    const dcmap = componentMap(d);
    const droot = hierarchyRoot(d);
    if (!droot) return;
    const walk = (node: RawElement, parentGuid?: string) => {
      const g = guidOf(node);
      if (g && parentGuid) parentOf.set(g, parentGuid);
      const comp = g ? dcmap.get(g) : undefined;
      const axis = comp ? sliderAxis(comp) : null;
      if (g && axis) {
        let handle: string | undefined;
        for (const ch of elementChildren(node)) {
          const cg = guidOf(ch);
          const cc = cg ? dcmap.get(cg) : undefined;
          if (cc && isSliderHandle(cc)) { handle = cg ?? undefined; break; }
        }
        if (!handle) handle = guidOf(elementChildren(node)[0] ?? node) ?? undefined;
        sliders.push({ guid: g, parent: parentGuid ?? "", axis, handle });
      }
      for (const ch of elementChildren(node)) walk(ch, g ?? parentGuid);
    };
    walk(droot, undefined);
  };
  collectSliders(doc);
  for (const sub of Object.values(created)) collectSliders(sub);

  const itemByGuid = new Map(items.map((it) => [it.guid, it] as const));
  for (const s of sliders) {
    if (s.axis !== "v") continue; // horizontal scrolling not implemented yet
    const sc = scrollables.find((v) => parentOf.get(v.guid) === s.parent);
    const sliderItem = itemByGuid.get(s.guid);
    if (!sc || !sliderItem) continue;
    const track = sliderItem.rect;
    sliderLinks.push({ viewportGuid: sc.guid, sliderGuid: s.guid, handleGuid: s.handle, axis: "v", track });
    // Move the handle along the track by the scroll fraction. Mutate the rect in
    // place so its image boxes (which share the rect object) travel with it.
    const handleItem = s.handle ? itemByGuid.get(s.handle) : undefined;
    if (handleItem) {
      const max = Math.max(1, sc.contentHeight - sc.viewHeight);
      const frac = Math.min(1, Math.max(0, (sim?.scroll[sc.guid] ?? 0) / max));
      const travel = Math.max(0, track.h - handleItem.rect.h);
      handleItem.rect.y = track.y + frac * travel;
    }
  }

  return { items, canvas, scrollables, sliderLinks };
}

interface Placed {
  node: RawElement;
  comp: RawElement;
  state?: RawElement;
  rect: Rect;
  scope?: Scope;
}

/** A list/ContextList container's data entries (empty when it resolves no data). Shared by
 *  the render recursion and the layout-engine measurer so an empty list collapses identically.
 *   - CharacterList: the character assigned to the propagated post (`__postKey`/`__roleArt`).
 *   - CcoScriptObject `TableValue.Value`: the published table iterated as script nodes.
 *   - otherwise: the named data-pack table. */
export function listEntries(comp: RawElement, scope: Scope): { key: string; value: LuaValue }[] {
  const listCb = callbacks(comp).find((c) => c.id === "List" || c.id === "ContextList");
  if (!listCb) return [];
  if (listCb.funcId && /CharacterList/.test(listCb.funcId)) {
    const postKey = scope.vars.__postKey;
    const roleArt = scope.vars.__roleArt;
    if (typeof postKey === "string" && roleArt && typeof roleArt === "object" && !Array.isArray(roleArt)) {
      const art = (roleArt as Record<string, LuaValue>)[postKey];
      if (art !== undefined) return [{ key: postKey, value: { ArtContext: art } }];
    }
    return [];
  }
  if (isScriptValueList(listCb.funcId)) {
    return scriptNodes(scope.dataPack).map((value, i) => ({ key: String(i), value }));
  }
  const key = listSource(comp);
  const table =
    key && scope.dataPack && typeof scope.dataPack === "object" && !Array.isArray(scope.dataPack)
      ? (scope.dataPack as Record<string, LuaValue>)[key]
      : undefined;
  return table !== undefined ? toEntries(table) : [];
}

/** True when `comp` is a `sizetocontent` list with no data: in-game it collapses to nothing,
 *  so a parent layout engine must reserve ZERO space for it (not its placeholder state size).
 *  Lets a sibling (e.g. the court `empty_slot_holder`) reflect the real content width. */
export function collapsesEmpty(comp: RawElement | undefined, scope: Scope | undefined): boolean {
  if (!comp || !scope) return false;
  const le = getLayoutEngine(comp);
  if (!le || getAttr(le, "sizetocontent") !== "true") return false;
  if (!callbacks(comp).some((c) => c.id === "List" || c.id === "ContextList")) return false;
  return listEntries(comp, scope).length === 0;
}

/** Re-centre a `sizetocontent` container's laid-out content within its (state-sized) rect using
 *  the container's OWN anchor. In-game such a container shrinks to its content and its docking
 *  re-centres it; we keep the cached state-sized rect, so without this the content sits at the
 *  rect's leading edge (e.g. the court `empty_slot_holder` lands in the holder's right half).
 *  Only containers with an explicit `component_anchor_point` shift (default 0 = no-op), so
 *  left/top-anchored rows are untouched. */
export function recenterSizeToContent(placed: Placed[], le: RawElement, comp: RawElement, origin: Rect): Placed[] {
  if (!placed.length || getAttr(le, "sizetocontent") !== "true") return placed;
  const horizontal = (getAttr(le, "type") ?? "List") === "HorizontalList";
  const [ax, ay] = parseVec2(getAttr(comp, "component_anchor_point"), [0, 0]);
  const a = horizontal ? ax : ay;
  if (a === 0) return placed;
  if (horizontal) {
    const contentW = Math.max(...placed.map((p) => p.rect.x + p.rect.w)) - origin.x;
    const shift = a * (origin.w - contentW);
    return Math.abs(shift) < 0.5 ? placed : placed.map((p) => ({ ...p, rect: { ...p.rect, x: p.rect.x + shift } }));
  }
  const contentH = Math.max(...placed.map((p) => p.rect.y + p.rect.h)) - origin.y;
  const shift = a * (origin.h - contentH);
  return Math.abs(shift) < 0.5 ? placed : placed.map((p) => ({ ...p, rect: { ...p.rect, y: p.rect.y + shift } }));
}

/** Measures a `sizetocontent` container's true content size (bbox of its laid-out children),
 *  so a parent layout engine can position/centre it by its content rather than its state size.
 *  Returns undefined for anything that should keep its state size. */
export type ContentSizeFn = (
  node: RawElement,
  comp: RawElement,
  scope: Scope | undefined,
  cmap: Map<string, RawElement> | undefined
) => { w: number; h: number } | undefined;

export function layoutEngine(
  le: RawElement,
  children: { node: RawElement; comp: RawElement; state?: RawElement; scope?: Scope }[],
  parentRect: Rect,
  templates: Templates,
  honorOffsets = false,
  contentSizeOf?: ContentSizeFn,
  cmap?: Map<string, RawElement>
): Placed[] {
  const type = getAttr(le, "type") ?? "List";
  const [sx, sy] = parseVec2(getAttr(le, "spacing"), [0, 0]);
  const [mx, my] = parseVec2(getAttr(le, "margins"), [0, 0]);
  const reverse = getAttr(le, "reverse_order") === "true";
  const valign = getAttr(le, "vertical_alignment");
  const halign = getAttr(le, "horizontal_alignment");
  const horizontal = type === "HorizontalList";
  const sizeToContent = getAttr(le, "sizetocontent") === "true";

  // Child size for the engine. With `sizetocontent`, a button that resizes to its text
  // (`texthbehaviour="Resize"`) is measured at its (estimated) text width, not the state's
  // design-time fallback (e.g. 828, which would space children off-screen). Fixed-width
  // columns like `label_name` (no Resize) keep their declared size so siblings aren't bunched.
  const measure = (
    node: RawElement | undefined,
    comp: RawElement,
    state: RawElement | undefined,
    scope?: Scope
  ): { w: number; h: number } => {
    // An empty sizetocontent list contributes no space (it collapses in-game).
    if (collapsesEmpty(comp, scope)) return { w: 0, h: 0 };
    // A sizetocontent container is measured by its real content, so a parent centres/stacks it
    // by its true extent (e.g. top_row sized to leader+heir, not just the leader's state width).
    const cs = node && contentSizeOf?.(node, comp, scope, cmap);
    if (cs) return cs;
    const s = sizeFor(comp, state, parentRect, templates);
    if (sizeToContent && state && getAttr(state, "texthbehaviour") === "Resize") {
      const t = getAttr(state, "text");
      if (t) {
        const [il, ir] = parseVec2(getAttr(state, "textxoffset"), [0, 0]);
        const size = num(state, "font_m_size", 13);
        const txt = decodeEntities(t);
        // Real font metrics when available (visualizer), else the char-count estimate.
        const tw = activeMeasureText
          ? activeMeasureText(txt, getAttr(state, "font_m_font_name"), size)
          : estimateTextWidth(txt, size);
        return { w: tw + il + ir, h: s.h };
      }
    }
    return s;
  };

  // Fixed column widths from <columnwidths><column width=.../></columnwidths>.
  const colWidths: number[] = [];
  const cwEl = elementChildren(le).find((c) => c.tag === "columnwidths");
  if (cwEl) {
    for (const col of elementChildren(cwEl)) {
      const w = parseFloat(getAttr(col, "width") ?? "");
      if (!Number.isNaN(w)) colWidths.push(w);
    }
  }
  // Columns-per-row: explicit `itemsperrow`, else implied by column count.
  const perRow = parseInt(getAttr(le, "itemsperrow") ?? "", 10);
  const cols =
    Number.isFinite(perRow) && perRow >= 2
      ? perRow
      : colWidths.length >= 2
        ? colWidths.length
        : 1;

  const ordered = reverse ? [...children].reverse() : children;
  const out: Placed[] = [];

  // Grid: a vertical List that packs `cols` items per row, then wraps.
  if (!horizontal && cols > 1) {
    let col = 0;
    let cy = parentRect.y + my;
    let rowH = 0;
    let x = parentRect.x + mx;
    for (const { node, comp, state, scope } of ordered) {
      const { w, h } = measure(node, comp, state, scope);
      // `sizetocontent` packs columns to their content; fixed `columnwidths` apply only
      // to non-content grids (else tiny items get spaced by the full column width).
      const step = !sizeToContent && colWidths.length ? colWidths[Math.min(col, colWidths.length - 1)] : w;
      out.push({ node, comp, state, rect: { x, y: cy, w, h }, scope });
      rowH = Math.max(rowH, h);
      x += step + sx;
      col++;
      if (col === cols) {
        col = 0;
        cy += rowH + sy;
        rowH = 0;
        x = parentRect.x + mx;
      }
    }
    return out;
  }

  // Single line: List (vertical) or HorizontalList.
  let cx = parentRect.x + mx;
  let cy = parentRect.y + my;
  for (const { node, comp, state, scope } of ordered) {
    const { w, h } = measure(node, comp, state, scope);
    // A child's `offset` inside a LayoutEngine is normally the editor's CACHED
    // engine-computed position, which the engine reproduces by stacking — so adding it would
    // double-count. But for a STATIC child in a HorizontalList (honorOffsets, set when the
    // container has no anchor) the offset is the child's real position relative to the parent
    // (like positionChild) and may NOT equal the stacked position (e.g. a `faction_heir`
    // overlapping the leader). Honour it as an ABSOLUTE position. Text-resize children re-stack
    // by measured width, so their offset is skipped.
    const offsetAttr = comp ? getAttr(comp, "offset") : undefined;
    const useOffset =
      honorOffsets &&
      horizontal &&
      offsetAttr !== undefined &&
      !(sizeToContent && state && getAttr(state, "texthbehaviour") === "Resize");

    let x: number;
    let y: number;
    if (useOffset) {
      const [ox, oy] = parseVec2(offsetAttr, [0, 0]);
      x = parentRect.x + ox;
      y = parentRect.y + oy;
    } else if (horizontal) {
      x = cx;
      y = valign === "Center" ? parentRect.y + (parentRect.h - h) / 2 : cy;
    } else {
      x = halign === "Center" ? parentRect.x + (parentRect.w - w) / 2 : cx;
      y = cy;
    }
    out.push({ node, comp, state, rect: { x, y, w, h }, scope });
    // A collapsed (zero-size) child consumes no spacing, so it leaves no phantom gap.
    if (horizontal) cx += w ? w + sx : 0;
    else cy += h ? h + sy : 0;
  }
  return out;
}
