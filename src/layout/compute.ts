// Compute absolute rectangles for every component by walking the hierarchy and
// combining docking + offset + anchor (or a LayoutEngine's auto-stacking).
//
// The docking math is calibrated so the checkbox label (docking "Center Right
// External", anchor 0,0.5, offset 24,-3) lands just right of the 24px box.
// External docking is treated like its non-external edge for positioning v1
// (the anchor/offset already place the child outside); refine later if needed.

import { RawElement, TwuiDocument, FactionContext } from "../types/twui";
import {
  activeState,
  componentImages,
  componentMap,
  elementChildren,
  getAttr,
  getLayoutEngine,
  guidOf,
  hierarchyRoot,
  parseVec2,
} from "../twui/doc";
import { ContextTokens, conditionDecision, contextDecision } from "../twui/context";
import { isTemplated, ResolvedLayer, resolveTemplated } from "../twui/template";
import {
  AMBITION_TASKS,
  AMBITION_TRADEOFFS,
  ambitionGuids,
  isAmbitionPanel,
  taskTitle,
} from "../twui/ambition";

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
  images: DrawImage[];
}

export interface LayoutResult {
  items: RenderItem[];
  canvas: Rect;
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
  // `offset` is the child's top-left relative to the parent's top-left and ALREADY
  // bakes in docking/anchor (it's the editor's cached layout position, and equals
  // `dockingTerm + dock_offset`). So when present, use it directly — applying the
  // docking term again double-counts (shifts components off their spot).
  const offsetAttr = getAttr(comp, "offset");
  if (offsetAttr !== undefined) {
    const [ox, oy] = parseVec2(offsetAttr, [0, 0]);
    return { x: parent.x + ox, y: parent.y + oy, w, h };
  }

  // No explicit offset: derive position purely from docking + anchor.
  // `dock_offset` is the editor's CACHED value and is unreliable (e.g. the topbar
  // container has dock_offset="-426" but should sit at top-left) — never apply it.
  // Regular components use `docking`; templated instances use `dock_point`.
  const { hf, vf, extAxis } = dockInfo(getAttr(comp, "docking") ?? getAttr(comp, "dock_point"));
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

/** Images for a component: templated -> resolved layers; else inline imagemetrics. */
function imagesForComp(
  comp: RawElement,
  state: RawElement | undefined,
  rect: Rect,
  templates: Templates
): DrawImage[] {
  if (isTemplated(comp)) {
    const r = resolveTemplated(comp, templates);
    if (r) return layerImages(r.layers, rect);
    return [];
  }
  return imagesFor(comp, state, rect);
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

function imagesFor(comp: RawElement, state: RawElement | undefined, rect: Rect): DrawImage[] {
  if (!state) return [];
  const metrics = state.children.filter(
    (c): c is RawElement => c.kind === "element" && c.tag === "imagemetrics"
  )[0];
  if (!metrics) return [];

  const pathByGuid = new Map<string, string>();
  const sizeByGuid = new Map<string, { w?: number; h?: number }>();
  for (const ci of componentImages(comp)) {
    const g = guidOf(ci);
    const p = getAttr(ci, "imagepath");
    if (!g) continue;
    if (p) pathByGuid.set(g, p);
    sizeByGuid.set(g, { w: numOpt(ci, "width"), h: numOpt(ci, "height") });
  }

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
  loc?: Record<string, string>
): LayoutResult {
  const items: RenderItem[] = [];
  const root = hierarchyRoot(doc);
  const cmap = componentMap(doc);
  if (!root) return { items, canvas: { x: 0, y: 0, w: 1920, h: 1080 } };

  const rootComp = cmap.get(guidOf(root) ?? "");
  const rootState = rootComp ? activeState(rootComp) : undefined;
  const canvas: Rect = {
    x: 0,
    y: 0,
    w: num(rootState, "width", 1920),
    h: num(rootState, "height", 1080),
  };

  // The Liu Yan ambition panel is script-driven: its main tab is hidden in the
  // static XML and its task/trade-off rows are cloned at runtime. Force the
  // pre-inheritance tab visible, hide the post tab + the prototype rows, and
  // (below) inject the real rows.
  const amb = isAmbitionPanel(doc) ? ambitionGuids(doc) : null;
  const forceShow = new Set<string>([amb?.tabPre].filter(Boolean) as string[]);
  const forceHide = new Set<string>(
    [amb?.tabPost, amb?.templateMission, amb?.templateTradeOff].filter(Boolean) as string[]
  );

  // Visibility decision: forced overrides, then campaign gate, then
  // faction/subculture filter, then flag.
  const shouldRender = (comp: RawElement, state: RawElement | undefined): boolean => {
    const g = guidOf(comp);
    if (g && forceHide.has(g)) return false;
    if (g && forceShow.has(g)) return true;
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
    depth: number,
    clip: Rect | null
  ) => {
    items.push({
      guid: guidOf(hierNode) ?? "",
      tag: hierNode.tag,
      rect,
      priority: num(comp, "priority", 0),
      visible: true,
      depth,
      clip: clip ?? undefined,
      text: state ? getAttr(state, "text") : undefined,
      fontColour: state ? getAttr(state, "font_m_colour") : undefined,
      fontSize: state ? num(state, "font_m_size", 13) : undefined,
      textHAlign: state ? getAttr(state, "texthalign") : undefined,
      textVAlign: state ? getAttr(state, "textvalign") : undefined,
      images: imagesForComp(comp, state, rect, templates),
    });
  };

  // Render a visible child, then recurse into it carrying the clip region.
  const emit = (
    child: RawElement,
    comp: RawElement,
    state: RawElement | undefined,
    rect: Rect,
    depth: number,
    clip: Rect | null
  ) => {
    pushItem(child, comp, state, rect, depth, clip);
    const childClip =
      getAttr(comp, "clipchildren") === "true" ? intersectRect(clip, rect) : clip;
    recurse(child, rect, depth + 1, childClip);
  };

  const recurse = (hierNode: RawElement, parentRect: Rect, depth: number, clip: Rect | null) => {
    const comp = cmap.get(guidOf(hierNode) ?? "");
    const children = elementChildren(hierNode);
    const le = comp ? getLayoutEngine(comp) : undefined;

    // Filter to visible children up front (so layout engines don't reserve
    // space for hidden ones).
    const visible: { node: RawElement; comp: RawElement; state?: RawElement }[] = [];
    for (const child of children) {
      const cc = cmap.get(guidOf(child) ?? "");
      if (!cc) continue;
      const st = activeState(cc);
      if (!shouldRender(cc, st)) continue;
      visible.push({ node: child, comp: cc, state: st });
    }

    if (le && visible.length) {
      for (const { node, comp: cc, state, rect } of layoutEngine(le, visible, parentRect, templates)) {
        emit(node, cc, state, rect, depth, clip);
      }
      return;
    }

    for (const { node, comp: cc, state } of visible) {
      const { w, h } = sizeFor(cc, state, parentRect, templates);
      const rect = positionChild(parentRect, cc, w, h);
      emit(node, cc, state, rect, depth, clip);
    }
  };

  // Root always renders and fills the canvas.
  if (rootComp) {
    pushItem(root, rootComp, rootState, canvas, 0, null);
    const rootClip = getAttr(rootComp, "clipchildren") === "true" ? canvas : null;
    recurse(root, canvas, 1, rootClip);
  }

  // Populate the ambition panel's task / trade-off lists (the script does this
  // at runtime) using the real container rects produced above.
  if (amb) injectAmbitionRows(items, amb, loc);

  return { items, canvas };
}

/** Build a render item that draws a single image filling `rect`. */
function imageItem(guid: string, rect: Rect, imagepath: string, clip: Rect | null): RenderItem {
  return {
    guid,
    tag: guid,
    rect,
    priority: 1000,
    visible: true,
    depth: 20,
    clip: clip ?? undefined,
    images: [{ imagepath, box: rect, hf: 0, vf: 0, ox: 0, oy: 0, w: rect.w, h: rect.h }],
  };
}

/** Build a render item that draws a line of text in `rect`. */
function textItem(
  guid: string,
  rect: Rect,
  text: string,
  colour: string,
  size: number,
  clip: Rect | null
): RenderItem {
  return {
    guid,
    tag: guid,
    rect,
    priority: 1000,
    visible: true,
    depth: 20,
    clip: clip ?? undefined,
    text,
    fontColour: colour,
    fontSize: size,
    textHAlign: "Left",
    textVAlign: "Center",
    images: [],
  };
}

/**
 * Append the ambition panel's dynamic rows. Anchored to the live rects of the
 * mission scroll viewport (`list_clip`) and the trade-off row
 * (`trade_offs_holder`); skips quietly if those weren't rendered.
 */
function injectAmbitionRows(
  items: RenderItem[],
  amb: ReturnType<typeof ambitionGuids>,
  loc?: Record<string, string>
): void {
  const rectOf = (guid?: string): Rect | undefined =>
    guid ? items.find((i) => i.guid === guid)?.rect : undefined;

  const listRect = rectOf(amb.listClip);
  if (listRect) {
    const rowH = 88;
    const gap = 5;
    const pad = 10;
    const iconSize = 64;
    const rewardSize = 44;
    AMBITION_TASKS.forEach((t, i) => {
      const rowY = listRect.y + i * (rowH + gap);
      const iconRect: Rect = { x: listRect.x + pad, y: rowY + (rowH - iconSize) / 2, w: iconSize, h: iconSize };
      items.push(imageItem(`amb-task-icon-${i}`, iconRect, t.icon, listRect));
      const titleRect: Rect = { x: iconRect.x + iconSize + 14, y: rowY + 12, w: listRect.w - iconSize - rewardSize - pad * 3 - 14, h: 24 };
      items.push(textItem(`amb-task-title-${i}`, titleRect, taskTitle(t, loc), "#FFF2D0", 17, listRect));
      const rwRect: Rect = { x: listRect.x + listRect.w - rewardSize - pad, y: rowY + (rowH - rewardSize) / 2, w: rewardSize, h: rewardSize };
      items.push(imageItem(`amb-task-reward-${i}`, rwRect, t.rewardIcon, listRect));
    });
  }

  const tradeRect = rectOf(amb.tradeOffsHolder);
  if (tradeRect) {
    const iconSize = 64;
    const spacing = 27;
    AMBITION_TRADEOFFS.forEach((t, i) => {
      const x = tradeRect.x + i * (iconSize + spacing);
      const r: Rect = { x, y: tradeRect.y + (tradeRect.h - iconSize) / 2, w: iconSize, h: iconSize };
      items.push(imageItem(`amb-trade-${i}`, r, t.icon, null));
    });
  }
}

interface Placed {
  node: RawElement;
  comp: RawElement;
  state?: RawElement;
  rect: Rect;
}

function layoutEngine(
  le: RawElement,
  children: { node: RawElement; comp: RawElement; state?: RawElement }[],
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

  const ordered = reverse ? [...children].reverse() : children;
  let cx = parentRect.x + mx;
  let cy = parentRect.y + my;
  const out: Placed[] = [];

  for (const { node, comp, state } of ordered) {
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
    out.push({ node, comp, state, rect: { x, y, w, h } });
    if (horizontal) cx += w + sx;
    else cy += h + sy;
  }
  return out;
}
