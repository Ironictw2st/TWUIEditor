import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import ToolPalette from "./ToolPalette";
import { computeLayout, imageDrawRect, LayoutResult, nineSliceRegions, Rect, Scrollable, Sim, textAnchor } from "../layout/compute";
import { parseColour } from "../twui/colour";
import { fontSpec } from "../twui/fonts";
import { LuaValue } from "../twui/lua";
import { useLayoutInputs } from "../state/useLayoutInputs";
import { componentMap, guidOf } from "../twui/doc";
import { buttonGroup, clickableStates, interactiveTarget } from "../twui/sim";
import { locateHier } from "../twui/mutate";
import { mouseModifierHeld, multiSelectBinding } from "../keybinds";
import { imageUrl } from "../ipc/commands";
import { setCaptureFn } from "./visualizerCapture";

const EMPTY_SIM: Sim = { scroll: {}, state: {}, show: [], hide: [] };

// Images the game replaces at runtime (faction flags, dynamic icons, unit cards)
// plus runtime portrait/character-render textures (masks, empty faces, body
// silhouettes) — all drawn faint so they don't dominate as opaque blocks.
function isFaint(path: string): boolean {
  return /placeholer|placeholder|ph_|_placeholer|mask|empty_face|halfbody|fullbody_character/i.test(path);
}

// Reused offscreen canvas for tinted blits (no per-image allocation).
let tintCanvas: HTMLCanvasElement | null = null;

// Reused offscreen 2d context for real text measurement (canvas metrics).
let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(text: string, fontName: string | undefined, sizePx: number): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * sizePx * 0.5;
  measureCtx.font = fontSpec(fontName, sizePx);
  return measureCtx.measureText(text).width;
}

/** Draw `img` into `rect` tinted by `rgb` (multiply) while keeping the texture's own
 *  per-pixel alpha — so a black-tinted frame becomes a black border, not a black fill. */
function drawImageTinted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: Rect,
  rgb: string,
  alpha: number,
  src?: Rect
): void {
  const sx = src?.x ?? 0;
  const sy = src?.y ?? 0;
  const sw = src?.w ?? img.naturalWidth;
  const sh = src?.h ?? img.naturalHeight;
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  if (!tintCanvas) tintCanvas = document.createElement("canvas");
  const tc = tintCanvas;
  tc.width = w;
  tc.height = h;
  const tctx = tc.getContext("2d");
  if (!tctx) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    return;
  }
  tctx.clearRect(0, 0, w, h);
  tctx.globalCompositeOperation = "source-over";
  tctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  tctx.globalCompositeOperation = "multiply";
  tctx.fillStyle = rgb;
  tctx.fillRect(0, 0, w, h);
  // Restore the original texture alpha (multiply/fill ignored it).
  tctx.globalCompositeOperation = "destination-in";
  tctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  tctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.drawImage(tc, rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
}

/** Paint the design surface: canvas background, its border, and every layout item (images +
 *  text) in DFS order. This is the shared scene-painting pass used by both the live canvas
 *  (after it applies the pan/zoom transform, then draws selection/hover overlays on top) and
 *  the offscreen native-resolution capture (identity transform, no overlays). `zoom` only
 *  scales hairline widths so 1px strokes stay 1px on screen; pass 1 for native capture. */
function drawScene(
  ctx: CanvasRenderingContext2D,
  layout: LayoutResult,
  opts: { getImage: (path: string) => HTMLImageElement | null; background: string | null; zoom: number }
): void {
  const { getImage, background, zoom } = opts;

  // Canvas background (the design surface). `@white`/`@black` are solid-colour choices; any
  // other non-empty value is a background image path (the campaign map) behind the HUD.
  const cv = layout.canvas;
  const solidBg = background === "@white" ? "#ffffff" : background === "@black" ? "#000000" : null;
  ctx.fillStyle = solidBg ?? "#0c0d12";
  ctx.fillRect(cv.x, cv.y, cv.w, cv.h);
  if (background && !solidBg) {
    const bg = getImage(background);
    if (bg && bg.complete && bg.naturalWidth > 0) {
      try {
        ctx.drawImage(bg, cv.x, cv.y, cv.w, cv.h);
      } catch {
        /* ignore */
      }
    }
  }
  ctx.strokeStyle = "#2a2d3a";
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(cv.x, cv.y, cv.w, cv.h);

  // Draw items in DFS order (parents behind children).
  for (const item of layout.items) {
    if (!item.visible) continue;
    const clipped = !!item.clip && item.clip.w > 0 && item.clip.h > 0;
    if (clipped) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(item.clip!.x, item.clip!.y, item.clip!.w, item.clip!.h);
      ctx.clip();
    }
    for (const di of item.images) {
      const img = getImage(di.imagepath);
      if (img && img.complete && img.naturalWidth > 0) {
        // Size to the image's natural pixels when no explicit size was given.
        const r = imageDrawRect(di, img.naturalWidth, img.naturalHeight);
        // Apply the image's `colour`: RGB as a multiply tint, alpha as opacity.
        // Runtime-swapped placeholders are drawn faint so they don't dominate.
        const { rgb, alpha } = parseColour(di.colour);
        const a = alpha * (isFaint(di.imagepath) ? 0.25 : 1);
        // A `margin` image draws as a nine-patch border (corners 1:1, edges/center
        // stretched) so a bordered texture isn't smeared across the whole rect.
        const regions = di.margin
          ? nineSliceRegions(r, img.naturalWidth, img.naturalHeight, di.margin)
          : null;
        try {
          if (regions) {
            for (const reg of regions) {
              if (rgb) drawImageTinted(ctx, img, reg.dst, rgb, a, reg.src);
              else {
                ctx.globalAlpha = a;
                ctx.drawImage(img, reg.src.x, reg.src.y, reg.src.w, reg.src.h, reg.dst.x, reg.dst.y, reg.dst.w, reg.dst.h);
                ctx.globalAlpha = 1;
              }
            }
          } else if (rgb) {
            drawImageTinted(ctx, img, r, rgb, a);
          } else {
            ctx.globalAlpha = a;
            ctx.drawImage(img, r.x, r.y, r.w, r.h);
            ctx.globalAlpha = 1;
          }
        } catch {
          /* ignore */
        }
      } else if (img && !img.complete) {
        // still loading; leave blank
      } else {
        // missing image -> hatched placeholder at its known/box size
        drawPlaceholder(ctx, imageDrawRect(di, 0, 0), zoom);
      }
    }
    if (item.text) {
      drawText(ctx, item);
    }
    if (clipped) ctx.restore();
  }
}

export default function VisualizerPanel() {
  const doc = useStore((s) => s.doc);
  const filePath = useStore((s) => s.filePath);
  const dataRoot = useStore((s) => s.dataRoot);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const selectedGuids = useStore((s) => s.selectedGuids);
  const select = useStore((s) => s.select);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const beginDrag = useStore((s) => s.beginDrag);
  const liveSetOffset = useStore((s) => s.liveSetOffset);
  const createAt = useStore((s) => s.createAt);
  const context = useStore((s) => s.context);
  const contextDb = useStore((s) => s.contextDb);
  const templates = useStore((s) => s.templates);
  const createdLayouts = useStore((s) => s.createdLayouts);
  const loc = useStore((s) => s.loc);
  const componentDataPacks = useStore((s) => s.componentDataPacks);
  const previewState = useStore((s) => s.previewState);
  const revealed = useStore((s) => s.revealed);
  const background = useStore((s) => s.background);
  const ccoShorthand = useStore((s) => s.ccoShorthand);

  const keybinds = useStore((s) => s.settings.keybinds);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [, forceTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const showBounds = useStore((s) => s.showBounds);
  const mode = useStore((s) => s.mode);
  const viz = useStore((s) => s.settings.visualizer);
  const updateSettings = useStore((s) => s.updateSettings);
  const paletteHidden = viz.palette.hidden;
  const renderResolution = useStore((s) => s.renderResolution);
  // Tooltip mode interacts like Simulation (scroll/click-sim, no selection).
  const simLike = mode === "sim" || mode === "tooltip";
  const [sim, setSim] = useState<Sim>(EMPTY_SIM);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  // Simulation state is per-document.
  useEffect(() => setSim(EMPTY_SIM), [doc]);

  // Re-measure once the bundled fonts load, so sizetocontent widths use real metrics.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Script data pack, DB-record contexts (PlayersFaction etc.) and perspective tokens —
  // shared with the hierarchy tree so visibility decisions agree.
  const { dataPack, staticVars, tokens } = useLayoutInputs();
  // The Inspector's state preview rides in sim.state (preview wins per component); the
  // hierarchy's force-show overrides ride in sim.show so a script-hidden component the user
  // revealed renders on the canvas too.
  const effectiveSim = useMemo(
    () => ({
      ...sim,
      state: { ...sim.state, ...previewState },
      show: [...sim.show, ...Object.keys(revealed).filter((g) => revealed[g])],
    }),
    [sim, previewState, revealed]
  );
  const layout: LayoutResult = useMemo(
    () =>
      doc
        ? computeLayout(
            doc,
            context,
            tokens,
            templates,
            loc,
            dataPack,
            effectiveSim,
            staticVars,
            mode === "tooltip",
            createdLayouts,
            ccoShorthand,
            componentDataPacks as Record<string, LuaValue>,
            measureText,
            contextDb?.ministerial_positions,
            renderResolution
          )
        : { items: [], canvas: { x: 0, y: 0, w: 1920, h: 1080 }, scrollables: [], sliderLinks: [] },
    // `fontsReady` is a dep so layout re-measures once the bundled fonts load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, context, tokens, templates, loc, dataPack, effectiveSim, staticVars, mode, createdLayouts, ccoShorthand, componentDataPacks, fontsReady, contextDb, renderResolution]
  );

  const getImage = useCallback((path: string): HTMLImageElement | null => {
    if (!dataRoot) return null;
    const cache = imgCache.current;
    let img = cache.get(path);
    if (!img) {
      img = new Image();
      // Load via CORS (the twuiimg protocol sends Access-Control-Allow-Origin: *) so the
      // canvas stays untainted and the bug-report capture can call toDataURL() on it.
      img.crossOrigin = "anonymous";
      img.onload = () => forceTick((t) => t + 1);
      img.onerror = () => forceTick((t) => t + 1);
      img.src = imageUrl(path);
      cache.set(path, img);
    }
    return img;
  }, [dataRoot]);

  // Resize canvas to container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const { zoom, panX, panY } = view;
    ctx.save();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

    // Paint the design surface + all items (shared with the offscreen capture).
    drawScene(ctx, layout, { getImage, background, zoom });

    // Structure outlines are opt-in (the "Bounds" toggle) so the preview stays clean.
    if (showBounds) {
      ctx.lineWidth = 1 / zoom;
      for (const item of layout.items) {
        if (selectedGuids.includes(item.guid) || item.guid === hover) continue;
        ctx.strokeStyle = "rgba(120,130,170,0.22)";
        ctx.strokeRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
      }
    }

    // Hover + selection highlight.
    const hi = (guid: string | null, colour: string, wdt: number) => {
      if (!guid) return;
      const it = layout.items.find((i) => i.guid === guid);
      if (!it) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = wdt / zoom;
      ctx.strokeRect(it.rect.x, it.rect.y, it.rect.w, it.rect.h);
    };
    // Hover highlight everywhere except Simulation; selection only in edit modes. The active
    // component (shown in the Inspector) is drawn thicker; other multi-selected a touch lighter.
    if (mode !== "sim") hi(hover, "rgba(201,162,39,0.6)", 1.5);
    if (!simLike) {
      for (const g of selectedGuids) hi(g, "#c9a227", g === selectedGuid ? 2.5 : 1.5);
    }

    // Scrollbars for clipped, overflowing lists (draggable in Sim/Tooltip mode).
    // Skip any viewport that has a real slider component — its handle IS the thumb.
    const sliderViewports = new Set(layout.sliderLinks.map((l) => l.viewportGuid));
    for (const sc of layout.scrollables) {
      if (sliderViewports.has(sc.guid)) continue;
      const sb = scrollbarRects(sc, sim.scroll[sc.guid] ?? 0);
      ctx.fillStyle = "rgba(18,20,28,0.55)";
      ctx.fillRect(sb.track.x, sb.track.y, sb.track.w, sb.track.h);
      ctx.fillStyle = simLike ? "rgba(201,162,39,0.9)" : "rgba(150,160,190,0.55)";
      ctx.fillRect(sb.thumb.x, sb.thumb.y, sb.thumb.w, sb.thumb.h);
    }

    ctx.restore();
  }, [doc, layout, view, size, selectedGuid, selectedGuids, hover, getImage, showBounds, background, sim, mode]);

  // Expose a clean, native-resolution PNG of the current layout for the bug-report menu.
  // Renders the shared scene (no pan/zoom/overlays) into an offscreen canvas sized to the
  // layout's own canvas, translated so (cv.x, cv.y) maps to the origin.
  useEffect(() => {
    setCaptureFn(() => {
      if (!doc) return null;
      const cv = layout.canvas;
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(cv.w));
      off.height = Math.max(1, Math.round(cv.h));
      const octx = off.getContext("2d");
      if (!octx) return null;
      octx.setTransform(1, 0, 0, 1, -cv.x, -cv.y);
      drawScene(octx, layout, { getImage, background, zoom: 1 });
      return off.toDataURL("image/png");
    });
    return () => setCaptureFn(null);
  }, [doc, layout, getImage, background]);

  // Interaction depends on the mode: View pans, Move edits offsets, Simulation
  // scrolls lists / clicks widgets.
  type DragState =
    | { kind: "pan"; x: number; y: number; panX: number; panY: number; moved: boolean }
    | { kind: "move"; guid: string; startWX: number; startWY: number; offX: number; offY: number; moved: boolean }
    | { kind: "scroll"; sc: Scrollable; startWY: number; startScroll: number }
    | { kind: "sliderdrag"; sc: Scrollable; travel: number; startWY: number; startScroll: number };
  const drag = useRef<DragState | null>(null);

  // Absolute rect of a component's parent (for converting a drag delta to offset).
  const parentRectOf = (guid: string): Rect | undefined => {
    if (!doc) return undefined;
    const loc = locateHier(doc, guid);
    const pg = loc?.parent ? guidOf(loc.parent) : null;
    if (!pg) return undefined;
    return layout.items.find((i) => i.guid === pg)?.rect;
  };

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
  };

  const hitTest = (wx: number, wy: number): string | null => {
    // Topmost (drawn last) first.
    for (let i = layout.items.length - 1; i >= 0; i--) {
      const r = layout.items[i].rect;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
        return layout.items[i].guid;
      }
    }
    return null;
  };

  const inRect = (wx: number, wy: number, r: Rect) =>
    wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
  const scrollableAt = (wx: number, wy: number): Scrollable | undefined =>
    layout.scrollables.find((s) => inRect(wx, wy, s.clip));
  const thumbAt = (wx: number, wy: number): Scrollable | undefined =>
    layout.scrollables.find((s) => inRect(wx, wy, scrollbarRects(s, sim.scroll[s.guid] ?? 0).thumb));
  // The real slider handle the pointer is over (its rect travels with the scroll),
  // plus the scrollable it drives and the handle's travel distance along the track.
  const sliderHandleAt = (wx: number, wy: number): { sc: Scrollable; travel: number } | undefined => {
    for (const link of layout.sliderLinks) {
      const handle = link.handleGuid ? layout.items.find((i) => i.guid === link.handleGuid) : undefined;
      if (!handle || !inRect(wx, wy, handle.rect)) continue;
      const sc = layout.scrollables.find((s) => s.guid === link.viewportGuid);
      if (sc) return { sc, travel: Math.max(1, link.track.h - handle.rect.h) };
    }
    return undefined;
  };
  const setScroll = (guid: string, v: number, sc: Scrollable) => {
    const max = Math.max(0, sc.contentHeight - sc.viewHeight);
    setSim((s) => ({ ...s, scroll: { ...s.scroll, [guid]: Math.min(max, Math.max(0, v)) } }));
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    const sc = simLike ? scrollableAt(w.x, w.y) : undefined;
    if (sc) {
      setScroll(sc.guid, (sim.scroll[sc.guid] ?? 0) + (e.deltaY > 0 ? 60 : -60), sc);
      return;
    }
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(8, Math.max(0.05, view.zoom * factor));
    const wx = (mx - view.panX) / view.zoom;
    const wy = (my - view.panY) / view.zoom;
    setView({ zoom: newZoom, panX: mx - wx * newZoom, panY: my - wy * newZoom });
  };

  // Click in Simulation mode: switch tabs (button group) or toggle press state.
  // It never selects/highlights — that's reserved for View/Move.
  const simClick = (guid: string) => {
    if (!doc) return;
    const bg = buttonGroup(doc, guid);
    if (bg && bg.panels.length === bg.buttons.length && bg.panels[bg.buttonIndex]) {
      const show = bg.panels[bg.buttonIndex];
      const hide = bg.panels.filter((p) => p !== show);
      setSim((s) => ({ ...s, show: [show], hide, state: { ...s.state, [bg.buttonGuid]: "selected" } }));
      return;
    }
    const target = interactiveTarget(doc, guid);
    if (target) {
      const tcomp = componentMap(doc).get(target);
      const states = tcomp ? clickableStates(tcomp) : [];
      setSim((s) => {
        const next = { ...s.state };
        if (next[target]) delete next[target];
        else if (states[0]) next[target] = states[0];
        return { ...s, state: next };
      });
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (simLike) {
      // The real slider handle (its viewport's synthetic scrollbar is suppressed).
      const sh = sliderHandleAt(w.x, w.y);
      if (sh) {
        drag.current = {
          kind: "sliderdrag",
          sc: sh.sc,
          travel: sh.travel,
          startWY: w.y,
          startScroll: sim.scroll[sh.sc.guid] ?? 0,
        };
        return;
      }
      const sc = thumbAt(w.x, w.y);
      if (sc) {
        drag.current = { kind: "scroll", sc, startWY: w.y, startScroll: sim.scroll[sc.guid] ?? 0 };
        return;
      }
    }
    if (mode === "move") {
      // Move operates on the CURRENTLY SELECTED component (chosen via the hierarchy or the
      // Select tool) — dragging anywhere moves it; it never re-selects what's under the cursor.
      const guid = selectedGuid;
      const item = guid ? layout.items.find((i) => i.guid === guid) : undefined;
      if (guid && item) {
        const parent = parentRectOf(guid) ?? layout.canvas;
        drag.current = {
          kind: "move",
          guid,
          startWX: w.x,
          startWY: w.y,
          offX: item.rect.x - parent.x,
          offY: item.rect.y - parent.y,
          moved: false,
        };
        return;
      }
    }
    drag.current = { kind: "pan", x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (d?.kind === "pan") {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
      setView({ panX: d.panX + dx, panY: d.panY + dy });
    } else if (d?.kind === "move") {
      const w = toWorld(e.clientX, e.clientY);
      const dx = w.x - d.startWX;
      const dy = w.y - d.startWY;
      const thr = 3 / view.zoom; // ~3 screen px before a drag begins
      if (!d.moved && Math.abs(dx) < thr && Math.abs(dy) < thr) return;
      if (!d.moved) {
        d.moved = true;
        beginDrag(); // one undo entry for the whole drag
      }
      liveSetOffset(d.guid, d.offX + dx, d.offY + dy);
    } else if (d?.kind === "scroll") {
      const w = toWorld(e.clientX, e.clientY);
      const sc = d.sc;
      const thumbH = Math.max(20, sc.clip.h * (sc.viewHeight / sc.contentHeight));
      const max = Math.max(1, sc.contentHeight - sc.viewHeight);
      const travel = Math.max(1, sc.clip.h - thumbH);
      setScroll(sc.guid, d.startScroll + ((w.y - d.startWY) / travel) * max, sc);
    } else if (d?.kind === "sliderdrag") {
      const w = toWorld(e.clientX, e.clientY);
      const max = Math.max(1, d.sc.contentHeight - d.sc.viewHeight);
      setScroll(d.sc.guid, d.startScroll + ((w.y - d.startWY) / d.travel) * max, d.sc);
    } else {
      const w = toWorld(e.clientX, e.clientY);
      setHover(mode === "sim" ? null : hitTest(w.x, w.y));
      if (mode === "tooltip") setTipPos({ x: e.clientX, y: e.clientY });
    }
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const d = drag.current;
    drag.current = null;
    // A pan that didn't move = a click → interact in Sim/Tooltip, create in Create, select in
    // Select. Move keeps the current selection (you pick via the hierarchy/Select tool) and never
    // re-selects from the canvas.
    if (d?.kind === "pan" && !d.moved) {
      const w = toWorld(e.clientX, e.clientY);
      const guid = hitTest(w.x, w.y);
      if (simLike) {
        if (guid) simClick(guid);
      } else if (mode === "create") {
        // Place a new component under the clicked component (its parent), or the root if the
        // click hit empty canvas; the offset is the click point relative to that parent's rect.
        const pRect = guid ? layout.items.find((i) => i.guid === guid)?.rect ?? layout.canvas : layout.canvas;
        createAt(guid, w.x - pRect.x, w.y - pRect.y);
      } else if (mode === "view" || mode === "align") {
        // Shift+Click (configurable modifier) adds/removes from the multi-selection; a plain
        // click selects just that component.
        if (guid && mouseModifierHeld(e, multiSelectBinding(keybinds))) toggleSelect(guid);
        else select(guid);
      }
    }
  };

  const fit = useCallback(() => {
    const cv = layout.canvas;
    const pad = 40;
    const zoom = Math.min((size.w - pad * 2) / cv.w, (size.h - pad * 2) / cv.h);
    setView({ zoom, panX: pad, panY: pad });
  }, [layout, size, setView]);

  useEffect(() => {
    // Auto-fit when a new document loads (keyed on filePath, not doc — every edit
    // replaces doc and would otherwise snap the view back to fit).
    if (doc) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  return (
    <div className="h-full flex flex-col">
      <div className="relative px-3 h-9 flex items-center gap-2 border-b border-edge shrink-0 bg-panel">
        <span className="font-semibold text-[12px]">Visualizer</span>
        <span className="text-[11px] text-gray-500">
          {layout.items.length} components · {layout.canvas.w}×{layout.canvas.h}
        </span>
        <span className="text-[11px] text-accent/80 capitalize">
          {mode === "view" ? "Select" : mode === "sim" ? "Simulate" : mode} tool
        </span>
        <div className="flex-1" />
        <button
          className={`px-2 py-0.5 rounded border border-edge text-[11px] ${
            paletteHidden
              ? "bg-button hover:bg-buttonHover"
              : "bg-accent/25 text-accent ring-1 ring-accent/50"
          }`}
          title={paletteHidden ? "Show tool palette" : "Hide tool palette"}
          onClick={() =>
            updateSettings({
              visualizer: { ...viz, palette: { ...viz.palette, hidden: !paletteHidden } },
            })
          }
        >
          Tools
        </button>
        <button
          className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
          onClick={fit}
        >
          Fit
        </button>
        <span className="text-[11px] text-gray-500 w-14 text-right">{Math.round(view.zoom * 100)}%</span>
      </div>
      <div ref={wrapRef} className="flex-1 min-h-0 relative overflow-hidden">
        <ToolPalette />
        {!doc && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-[13px]">
            Open a .twui.xml file to preview.
          </div>
        )}
        {doc && !dataRoot && (
          <div className="absolute top-2 left-2 right-2 text-[11px] text-amber-300/80 bg-amber-900/30 border border-amber-700/40 rounded px-2 py-1">
            Data root not set — images won't load. Set it from Settings.
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            width: size.w,
            height: size.h,
            cursor: drag.current
              ? "grabbing"
              : mode === "create"
              ? "crosshair"
              : mode === "move"
              ? "move"
              : simLike
              ? "pointer"
              : "grab",
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            drag.current = null;
            setHover(null);
            setTipPos(null);
          }}
        />
        {mode === "tooltip" &&
          tipPos &&
          hover &&
          (() => {
            const tip = layout.items.find((i) => i.guid === hover)?.tooltip;
            if (!tip) return null;
            return (
              <div
                className="fixed z-40 max-w-[320px] px-2 py-1 rounded bg-sunken border border-edge text-[11px] text-text whitespace-pre-wrap pointer-events-none shadow-lg"
                style={{ left: tipPos.x + 14, top: tipPos.y + 14 }}
              >
                {tip}
              </div>
            );
          })()}
      </div>
    </div>
  );
}

const SCROLLBAR_W = 8;
/** Track + thumb rects (world coords) for a scrollable list at a given scroll. */
function scrollbarRects(sc: Scrollable, scroll: number): { track: Rect; thumb: Rect } {
  const x = sc.clip.x + sc.clip.w - SCROLLBAR_W;
  const track: Rect = { x, y: sc.clip.y, w: SCROLLBAR_W, h: sc.clip.h };
  const max = Math.max(1, sc.contentHeight - sc.viewHeight);
  const thumbH = Math.max(20, sc.clip.h * (sc.viewHeight / sc.contentHeight));
  const frac = Math.min(1, Math.max(0, scroll / max));
  return { track, thumb: { x, y: sc.clip.y + frac * (sc.clip.h - thumbH), w: SCROLLBAR_W, h: thumbH } };
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, r: Rect, zoom: number) {
  if (r.w <= 0 || r.h <= 0) return;
  ctx.save();
  ctx.strokeStyle = "rgba(220,80,80,0.35)";
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.beginPath();
  ctx.moveTo(r.x, r.y);
  ctx.lineTo(r.x + r.w, r.y + r.h);
  ctx.moveTo(r.x + r.w, r.y);
  ctx.lineTo(r.x, r.y + r.h);
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, item: { rect: Rect; text?: string; fontColour?: string; fontSize?: number; fontName?: string; textHAlign?: string; textVAlign?: string; textInset?: { left: number; right: number; top: number; bottom: number } }) {
  if (!item.text) return;
  const size = item.fontSize ?? 13;
  ctx.save();
  ctx.fillStyle = item.fontColour && item.fontColour[0] === "#" ? item.fontColour.slice(0, 7) : "#ffffff";
  ctx.font = fontSpec(item.fontName, size);
  ctx.textBaseline = "middle";
  // textxoffset=(left,right), textyoffset=(top,bottom) define the inset box; align within it.
  const { tx, ty, align } = textAnchor(item.rect, item.textInset, item.textHAlign, item.textVAlign, size);
  ctx.textAlign = align;
  ctx.fillText(item.text, tx, ty);
  ctx.restore();
}
