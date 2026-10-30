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
