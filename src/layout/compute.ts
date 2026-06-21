// Compute absolute rectangles for every component by walking the hierarchy and
// combining docking + offset + anchor (or a LayoutEngine's auto-stacking).
//
// The docking math is calibrated so the checkbox label (docking "Center Right
// External", anchor 0,0.5, offset 24,-3) lands just right of the 24px box.
// External docking is treated like its non-external edge for positioning v1
// (the anchor/offset already place the child outside); refine later if needed.

import { CcoShorthand, RawElement, TwuiDocument, FactionContext } from "../types/twui";
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
import { ContextTokens, conditionDecision, contextDecision } from "../twui/context";
import { isTemplated, ResolvedLayer, resolveAgainst, resolveTemplated, templateIdMap } from "../twui/template";
import { LuaValue } from "../twui/lua";
import {
  callbacks,
  decodeEntities,
  evalExpr,
  evalImageSetter,
  evalTextLabel,
  listSource,
  propagate,
  resolveInlineTokens,
  Scope,
  scriptVisibility,
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
  textHAlign?: string;
  textVAlign?: string;
  /** State `textxoffset` — shifts the text within the rect (clears a bullet/icon). */
  textOffset?: { x: number; y: number };
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

function positionChild(parent: Rect, comp: RawElement, w: number, h: number): Rect {
  const docking = getAttr(comp, "docking");
  const dockPoint = getAttr(comp, "dock_point");
  const offsetAttr = getAttr(comp, "offset");
  const [ox, oy] = parseVec2(offsetAttr, [0, 0]);

  // Templated instances dock via `dock_point`, and their `offset` is a small nudge
  // RELATIVE to the dock anchor (e.g. a Top-Right vslider with offset="12,0", a
  // Center slot with offset="0,5") — NOT a cached absolute position. So apply the
  // dock term and add the offset; using offset directly would drop the docking and
  // strand the component near the parent's top-left.
  if (docking === undefined && dockPoint !== undefined) {
    const { hf, vf, extAxis } = dockInfo(dockPoint);
    const defAx = extAxis === "h" ? 1 - hf : hf;
    const defAy = extAxis === "v" ? 1 - vf : vf;
    const [ax, ay] = parseVec2(getAttr(comp, "component_anchor_point"), [defAx, defAy]);
    return {
      x: parent.x + hf * parent.w - ax * w + ox,
      y: parent.y + vf * parent.h - ay * h + oy,
      w,
      h,
    };
  }

  // Regular components: `offset` is the child's top-left relative to the parent's
  // top-left and ALREADY bakes in docking/anchor (the editor's cached layout
  // position, equal to `dockingTerm + dock_offset`). Use it directly — applying the
  // docking term again double-counts (shifts components off their spot).
  if (offsetAttr !== undefined) {
    return { x: parent.x + ox, y: parent.y + oy, w, h };
  }

  // No explicit offset: derive position purely from docking + anchor.
  // `dock_offset` is the editor's CACHED value and is unreliable (e.g. the topbar
  // container has dock_offset="-426" but should sit at top-left) — never apply it.
  const { hf, vf, extAxis } = dockInfo(docking);
  const defAx = extAxis === "h" ? 1 - hf : hf;
  const defAy = extAxis === "v" ? 1 - vf : vf;
  const [ax, ay] = parseVec2(getAttr(comp, "component_anchor_point"), [defAx, defAy]);
  return {
    x: parent.x + hf * parent.w - ax * w,
    y: parent.y + vf * parent.h - ay * h,
    w,
    h,
  };
}

type Templates = Record<string, TwuiDocument>;

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

/** A component is hidden when EITHER its tag or its active state says so. */
function isVisible(comp: RawElement, state: RawElement | undefined): boolean {
  const hidden = (el: RawElement | undefined) =>
    !!el && (getAttr(el, "visible") === "false" || getAttr(el, "is_visible") === "false");
  return !hidden(comp) && !hidden(state);
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
  ccoShorthand?: CcoShorthand | null
): LayoutResult {
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
  const canvas: Rect = {
    x: 0,
    y: 0,
    w: num(rootState, "width", 1920),
    h: num(rootState, "height", 1080),
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
  ): boolean => {
    const g = guidOf(comp);
    if (g && sim) {
      if (sim.hide.includes(g)) return false;
      if (sim.show.includes(g)) return true;
    }
    const sv = scriptVisibility(comp, scope);
    if (sv === "show") return true;
    if (sv === "hide") return false;
    if (ctx) {
      if (conditionDecision(comp, ctx) === "hide") return false;
      if (tokens) {
        const d = contextDecision(getAttr(comp, "id"), ctx, tokens);
        if (d === "show") return true;
        if (d === "hide") return false;
      }
    }
    return isVisible(comp, state);
  };

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

    // `textxoffset` shifts the text within the rect (to clear a bullet/icon).
    const txo = state ? getAttr(state, "textxoffset") : undefined;
    const [tox, toy] = parseVec2(txo, [0, 0]);

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
      textHAlign: state ? getAttr(state, "texthalign") : undefined,
      textVAlign: state ? getAttr(state, "textvalign") : undefined,
      textOffset: tox || toy ? { x: tox, y: toy } : undefined,
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
    lDoc: TwuiDocument
  ): number => {
    pushItem(child, comp, state, rect, parentRect, depth, clip, scope, cmap, lDoc);
    const childClip =
      getAttr(comp, "clipchildren") === "true" ? intersectRect(clip, rect) : clip;
    const sub = recurse(child, rect, depth + 1, childClip, scope, cmap, lDoc);
    return Math.max(rect.y + rect.h, sub);
  };

  // Returns the max bottom Y of everything emitted under hierNode.
  const recurse = (
    hierNode: RawElement,
    parentRect: Rect,
    depth: number,
    clip: Rect | null,
    scope: Scope,
    cmap: Map<string, RawElement>,
    lDoc: TwuiDocument
  ): number => {
    const comp = cmap.get(guidOf(hierNode) ?? "");
    const children = elementChildren(hierNode);
    const le = comp ? getLayoutEngine(comp) : undefined;

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
            emit(widget, wcomp, st, { x: origin.x, y: origin.y, w, h }, origin, depth, clip, wscope, subCmap, sub)
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
      let entries: { key: string; value: LuaValue }[] = [];
      if (listCb.funcId && /CharacterList/.test(listCb.funcId)) {
        // Character-post list (`CcoCampaignCharacterPost.CharacterList`): the character
        // the user assigned to the current post (`__postKey` from propagate), as a single
        // entry carrying its `ArtContext` (from `__roleArt`). Unassigned → empty.
        const postKey = scope.vars.__postKey;
        const roleArt = scope.vars.__roleArt;
        if (
          typeof postKey === "string" &&
          roleArt && typeof roleArt === "object" && !Array.isArray(roleArt)
        ) {
          const art = (roleArt as Record<string, LuaValue>)[postKey];
          if (art !== undefined) entries = [{ key: postKey, value: { ArtContext: art } }];
        }
      } else {
        const key = listSource(comp!);
        const table =
          key && scope.dataPack && typeof scope.dataPack === "object" && !Array.isArray(scope.dataPack)
            ? (scope.dataPack as Record<string, LuaValue>)[key]
            : undefined;
        entries = table !== undefined ? toEntries(table) : [];
      }
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
            track(emit(p.node, p.comp, p.state, p.rect, origin, depth, clip, p.scope ?? scope, cmap, lDoc));
          }
        } else {
          let y = origin.y;
          for (const inst of instances) {
            const { w, h } = sizeFor(inst.comp, inst.state, origin, templates);
            track(emit(inst.node, inst.comp, inst.state, { x: origin.x, y, w, h }, origin, depth, clip, inst.scope, cmap, lDoc));
            y += h;
          }
        }
      }
      return finish();
    }

    // Filter to visible children up front (so layout engines don't reserve
    // space for hidden ones). Apply any ContextPropagator sub-context per child.
    const visible: { node: RawElement; comp: RawElement; state?: RawElement; scope: Scope }[] = [];
    for (const child of children) {
      const cc = cmap.get(guidOf(child) ?? "");
      if (!cc) continue;
      const childScope = propagate(cc, scope);
      const st = stateFor(cc);
      if (!shouldRender(cc, st, childScope)) continue;
      visible.push({ node: child, comp: cc, state: st, scope: childScope });
    }

    if (le && visible.length) {
      for (const p of layoutEngine(le, visible, origin, templates)) {
        track(emit(p.node, p.comp, p.state, p.rect, origin, depth, clip, p.scope ?? scope, cmap, lDoc));
      }
      return finish();
    }

    for (const { node, comp: cc, state, scope: cs } of visible) {
      const { w, h } = sizeFor(cc, state, origin, templates);
      const rect = positionChild(origin, cc, w, h);
      track(emit(node, cc, state, rect, origin, depth, clip, cs, cmap, lDoc));
    }
    return finish();
  };

  // Root always renders and fills the canvas.
  if (rootComp) {
    pushItem(root, rootComp, rootState, canvas, canvas, 0, null, rootScope, cmap, doc);
    const rootClip = getAttr(rootComp, "clipchildren") === "true" ? canvas : null;
    recurse(root, canvas, 1, rootClip, rootScope, cmap, doc);
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

function layoutEngine(
  le: RawElement,
  children: { node: RawElement; comp: RawElement; state?: RawElement; scope?: Scope }[],
  parentRect: Rect,
  templates: Templates
): Placed[] {
  const type = getAttr(le, "type") ?? "List";
  const [sx, sy] = parseVec2(getAttr(le, "spacing"), [0, 0]);
  const [mx, my] = parseVec2(getAttr(le, "margins"), [0, 0]);
  const reverse = getAttr(le, "reverse_order") === "true";
  const valign = getAttr(le, "vertical_alignment");
  const halign = getAttr(le, "horizontal_alignment");
  const horizontal = type === "HorizontalList";

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
      const { w, h } = sizeFor(comp, state, parentRect, templates);
      const step = colWidths.length ? colWidths[Math.min(col, colWidths.length - 1)] : w;
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
    const { w, h } = sizeFor(comp, state, parentRect, templates);
    // NB: a child's `offset` inside a LayoutEngine is the editor's CACHED
    // engine-computed position (like dock_offset). The engine fully controls
    // placement, so we must NOT add it — doing so double-counts and spreads items.

    let x: number;
    let y: number;
    if (horizontal) {
      x = cx;
      y = valign === "Center" ? parentRect.y + (parentRect.h - h) / 2 : cy;
    } else {
      x = halign === "Center" ? parentRect.x + (parentRect.w - w) / 2 : cx;
      y = cy;
    }
    out.push({ node, comp, state, rect: { x, y, w, h }, scope });
    if (horizontal) cx += w + sx;
    else cy += h + sy;
  }
  return out;
}
