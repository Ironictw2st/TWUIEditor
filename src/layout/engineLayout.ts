// The 3K game's own layout rules (Three_Kingdoms.exe 1.7.2.0), as pure functions. Each one names
// the engine function it mirrors; notes/twui_engine.md in the script-extender workspace has the
// decompiled source. Used by compute.ts for 3K layout versions only.
//
// What the game does, in short:
// - Load: a component sits at parent + `offset`; an image at state + `offset`. Docking is NOT
//   re-applied at load, so `offset` already holds the docked position UIEd saved.
// - Docking only runs again when something changes size (a parent resize, a resolution change,
//   SetImage, a size animation): then position = trunc(dock cell) + `dock_offset`.
// - Resize (UIComponent vtable +0x98): a child scales by new/old unless `isrelativeresize`, in
//   which case it grows by the pixel delta; per axis only when allowed; then it re-docks.

/** Docking names in engine order (index = the stored enum value). */
export const ENGINE_DOCK = [
  "None",
  "Top Left", "Top Center", "Top Right",
  "Center Left", "Center", "Center Right",
  "Bottom Left", "Bottom Center", "Bottom Right",
  "Top Left External", "Top Center External", "Top Right External",
  "Center Left External", "Center External", "Center Right External",
  "Bottom Left External", "Bottom Center External", "Bottom Right External",
];

/** Engine enum value of a docking name: exact match, unknown -> 0 (None), like the reader. */
export function dockIndex(name: string | undefined): number {
  const i = name === undefined ? 0 : ENGINE_DOCK.indexOf(name);
  return i < 0 ? 0 : i;
}

/** Top-left of a `w`x`h` box docked into a `pw`x`ph` parent, relative to the parent, before the
 *  dock offset; null for None. Mirrors FUN_140565390 / FUN_1405a2980 (components) and
 *  FUN_140613d60 (images): column/row = cell % 3 / cell / 3; inner cells (and "Center External")
 *  centre-align, outer cells sit just outside; truncated toward zero. */
export function dockCell(dock: string | undefined, pw: number, ph: number, w: number, h: number): [number, number] | null {
  const d = dockIndex(dock);
  const u = d - 1;
  if (u < 0) return null;
  const v = u > 8 ? d - 10 : u;
  const col = v % 3;
  const row = Math.floor(v / 3);
  let x: number;
  let y: number;
  if (u < 9 || u === 13) {
    x = pw * 0.5 * col - w * 0.5 * col;
    y = ph * 0.5 * row - h * 0.5 * row;
  } else {
    x = (col - 2) * w * 0.5 + pw * 0.5 * col;
    y = (row - 2) * h * 0.5 + ph * 0.5 * row;
  }
  return [Math.trunc(x), Math.trunc(y)];
}

/** Round half away from zero, as the state's SetSize does (FUN_14062e6d0). */
export function roundAway(v: number): number {
  return Math.trunc(v + (v > 0 ? 0.5 : -0.5));
}

export interface EngineImage {
  w: number;
  h: number;
  /** offset relative to the state (what the game draws at) */
  ox: number;
  oy: number;
  dockpoint?: string;
  dockOffset: [number, number];
  canResizeWidth: boolean;
  canResizeHeight: boolean;
  isRelativeResize: boolean;
  isAspectRatioLocked: boolean;
}

/** Image SetSize (image metric vtable +8, FUN_14062e5b0): aspect lock first (needs both resize
 *  flags), then each allowed axis takes the new size, at least 1. */
function imageSetSize(img: EngineImage, w: number, h: number): EngineImage {
  if (img.isAspectRatioLocked && img.canResizeWidth && img.canResizeHeight) {
    if (h !== img.h) w = (img.w / img.h) * h;
    else h = (img.h / img.w) * w;
  }
  return {
    ...img,
    w: img.canResizeWidth && w !== img.w ? Math.max(w, 1) : img.w,
    h: img.canResizeHeight && h !== img.h ? Math.max(h, 1) : img.h,
  };
}

/** A state going from `fromW`x`fromH` to `toW`x`toH` (state SetSize, FUN_14062e6d0): the new size
 *  is rounded and must be positive; each image scales by new/old on the axes it may resize, or
 *  grows by the delta when `isrelativeresize`; then docked images re-dock (FUN_140613eb0). */
export function resizeStateImages(images: EngineImage[], fromW: number, fromH: number, toW: number, toH: number): EngineImage[] {
  const nw = roundAway(toW);
  const nh = roundAway(toH);
  if (!(nw > 0 && nh > 0) || (nw === fromW && nh === fromH)) return images;
  const fx = fromW !== 0 ? nw / fromW : 1;
  const fy = fromH !== 0 ? nh / fromH : 1;
  return images.map((img) => {
    const w = img.isRelativeResize ? nw - fromW + img.w : img.canResizeWidth ? img.w * fx : img.w;
    const h = img.isRelativeResize ? nh - fromH + img.h : img.canResizeHeight ? img.h * fy : img.h;
    const r = imageSetSize(img, w, h);
    const cell = dockCell(r.dockpoint, nw, nh, r.w, r.h);
    return cell ? { ...r, ox: cell[0] + r.dockOffset[0], oy: cell[1] + r.dockOffset[1] } : r;
  });
}

export interface ResizeFlags {
  allowHorizontal: boolean;
  allowVertical: boolean;
  isRelativeResize: boolean;
  isAspectRatioLocked: boolean;
}

/** Size a child takes when its parent goes from `from` to `to` (UIComponent Resize,
 *  FUN_14059bb70, applied to each child): scale by new/old, or the pixel delta when the child
 *  is `isrelativeresize`; then the child's own Resize keeps disallowed axes, applies the aspect
 *  lock (which needs both axes allowed), and its state rounds the result. */
export function childResize(
  child: { w: number; h: number },
  flags: ResizeFlags,
  from: { w: number; h: number },
  to: { w: number; h: number },
): { w: number; h: number } {
  if (from.w === to.w && from.h === to.h) return child;
  let w = flags.isRelativeResize ? child.w + (to.w - from.w) : from.w > 0 ? child.w * (to.w / from.w) : child.w;
  let h = flags.isRelativeResize ? child.h + (to.h - from.h) : from.h > 0 ? child.h * (to.h / from.h) : child.h;
  const changes = (w !== child.w && flags.allowHorizontal) || (h !== child.h && flags.allowVertical);
  if (!changes) return child;
  if (!flags.allowHorizontal) w = child.w;
  if (!flags.allowVertical) h = child.h;
  if (flags.isAspectRatioLocked) {
    if (!flags.allowHorizontal || !flags.allowVertical) return child;
    if (h === child.h) h = (child.h / child.w) * w;
    else w = (child.w / child.h) * h;
  }
  const rw = roundAway(w);
  const rh = roundAway(h);
  return rw > 0 && rh > 0 ? { w: rw, h: rh } : child;
}

export interface ListParams {
  horizontal: boolean;
  spacing: [number, number];
  /** main axis (start, end) */
  margins: [number, number];
  /** cross axis (start, end) */
  secondaryMargins: [number, number];
  itemsPerRow: number;
  /** cross-axis alignment: horizontal_alignment for List, vertical_alignment for HorizontalList */
  crossAlign?: string;
  skewAngle: number;
  sizeToContent: boolean;
  maxLength: number;
  minDimensions: [number, number];
  equalSpacingSize: number;
}

export interface ListItem {
  w: number;
  h: number;
  dockOffset: [number, number];
}

/** List / HorizontalList layout (base Layout FUN_14061fc70 with the List vtable 0x1432c06d8;
 *  HorizontalList 0x1432c27a0 is the same with the axes swapped). `items` are the visible
 *  children in placement order (reverse_order already applied). Returns each item's offset in
 *  the container and the container size after `sizetocontent`.
 *  - cursor starts at (secondary_margins.start, margins.start) [List: x = cross, y = main]
 *  - an item goes to cursor + its own dock_offset
 *  - inside a row (itemsperrow > 1) the cursor steps w + spacing.x; at a row end it steps the
 *    row's tallest item (truncated) + spacing.y and returns to secondary_margins.start, shifted by
 *    round(tan(skew_angle) * y)
 *  - sizetocontent: furthest edge + the end margins, main size capped by max_length, floored by
 *    min_dimensions / equal_spacing_size
 *  - single-row lists then align on the cross axis against the container's state size (not the
 *    content size): Center = round((W - w)/2 - sec.end) + x, Right = round(W - w - (x -
 *    sec.start) - sec.end)
 *  Checked against the offsets UIEd saved for vanilla list children: 98.3% (List) / 98.7%
 *  (HorizontalList) reproduce exactly; the rest are stale caches. */
export function listLayout(items: ListItem[], container: { w: number; h: number }, p: ListParams): { offsets: [number, number][]; size: { w: number; h: number } } {
  // Work in List orientation: x = cross axis, y = main axis.
  const T = (a: [number, number]): [number, number] => (p.horizontal ? [a[1], a[0]] : a);
  const sp = T(p.spacing);
  const perRow = Math.max(p.itemsPerRow, 0);
  const tanSkew = p.skewAngle ? Math.tan((p.skewAngle * Math.PI) / 180) : 0;
  let cx = p.secondaryMargins[0];
  let cy = p.margins[0];
  let rowMax = 0;
  const pos: [number, number][] = [];
  const dims = items.map((it) => T([it.w, it.h]));
  items.forEach((it, i) => {
    const [w, h] = dims[i];
    const d = T(it.dockOffset);
    pos.push([cx + d[0], cy + d[1]]);
    const endOfRow = perRow === 0 || (i + 1) % perRow === 0 || i === items.length - 1;
    if (!endOfRow) {
      cx += w + sp[0];
      rowMax = Math.max(rowMax, Math.trunc(h));
    } else {
      cy += Math.max(rowMax, Math.trunc(h)) + sp[1];
      cx = p.secondaryMargins[0];
      if (tanSkew) cx += roundAway(tanSkew * cy);
      rowMax = 0;
    }
  });
  const [aW] = T([container.w, container.h]);
  let [W, H] = T([container.w, container.h]);
  if (p.sizeToContent && items.length) {
    W = Math.max(...pos.map((q, i) => q[0] + dims[i][0])) + p.secondaryMargins[1];
    H = Math.max(...pos.map((q, i) => q[1] + dims[i][1])) + p.margins[1];
    if (p.maxLength > 0 && H > p.maxLength) H = p.maxLength;
    const [minW, minH] = T(p.minDimensions);
    if (minW > 0 && W < minW) W = minW;
    if (minH > 0 && H < minH) H = minH;
    if (p.equalSpacingSize > 0 && H < p.equalSpacingSize) H = p.equalSpacingSize;
  }
  const wantAlign = p.crossAlign === "Center" ? 1 : p.crossAlign === (p.horizontal ? "Bottom" : "Right") ? 2 : 0;
  if (wantAlign && perRow <= 1) {
    pos.forEach((q, i) => {
      const w = dims[i][0];
      q[0] =
        wantAlign === 1
          ? roundAway(aW * 0.5 - w * 0.5 - p.secondaryMargins[1]) + q[0]
          : roundAway(aW - w - (q[0] - p.secondaryMargins[0]) - p.secondaryMargins[1]);
    });
  }
  const [sw, sh] = T([W, H]);
  return { offsets: pos.map((q) => T(q)), size: { w: sw, h: sh } };
}

/** Position of a component relative to its parent after a re-dock (FUN_140565390): None keeps
 *  `offset`; any other docking = trunc(cell) + `dock_offset`. */
export function redockOffset(
  docking: string | undefined,
  offset: [number, number],
  dockOffset: [number, number],
  parent: { w: number; h: number },
  self: { w: number; h: number },
): [number, number] {
  const cell = dockCell(docking, parent.w, parent.h, self.w, self.h);
  return cell ? [cell[0] + dockOffset[0], cell[1] + dockOffset[1]] : offset;
}
