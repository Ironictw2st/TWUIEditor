import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";
import { computeLayout, imageDrawRect, LayoutResult, Rect } from "../layout/compute";
import { deriveTokens } from "../twui/context";
import { guidOf } from "../twui/doc";
import { locateHier } from "../twui/mutate";
import { imageUrl } from "../ipc/commands";

// Images the game replaces at runtime (faction flags, dynamic icons, unit cards).
function isPlaceholder(path: string): boolean {
  return /placeholer|placeholder|ph_|_placeholer/i.test(path);
}

function parseAlpha(colour: string | undefined): number {
  if (!colour || colour[0] !== "#") return 1;
  const hex = colour.slice(1);
  if (hex.length >= 8) {
    const a = parseInt(hex.slice(6, 8), 16);
    return isNaN(a) ? 1 : a / 255;
  }
  return 1;
}

export default function VisualizerPanel() {
  const doc = useStore((s) => s.doc);
  const dataRoot = useStore((s) => s.dataRoot);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const select = useStore((s) => s.select);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const beginDrag = useStore((s) => s.beginDrag);
  const liveSetOffset = useStore((s) => s.liveSetOffset);
  const context = useStore((s) => s.context);
  const contextDb = useStore((s) => s.contextDb);
  const templates = useStore((s) => s.templates);
  const loc = useStore((s) => s.loc);
  const background = useStore((s) => s.background);
  const setDataRoot = useStore((s) => s.setDataRoot);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [, forceTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [showBounds, setShowBounds] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPanel, setShowPanel] = useState(true);

  const tokens = useMemo(() => deriveTokens(contextDb), [contextDb]);
  const layout: LayoutResult = useMemo(
    () =>
      doc
        ? computeLayout(doc, context, tokens, templates, loc)
        : { items: [], canvas: { x: 0, y: 0, w: 1920, h: 1080 } },
    [doc, context, tokens, templates, loc]
  );

  const getImage = useCallback((path: string): HTMLImageElement | null => {
    if (!dataRoot) return null;
    const cache = imgCache.current;
    let img = cache.get(path);
    if (!img) {
      img = new Image();
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

    // Canvas background (the design surface).
    const cv = layout.canvas;
    ctx.fillStyle = "#0c0d12";
    ctx.fillRect(cv.x, cv.y, cv.w, cv.h);
    // Optional selected background image (the campaign map) behind the HUD.
    if (background) {
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
          // Runtime-swapped placeholders are drawn faint so they don't dominate.
          ctx.globalAlpha = parseAlpha(di.colour) * (isPlaceholder(di.imagepath) ? 0.25 : 1);
          try {
            ctx.drawImage(img, r.x, r.y, r.w, r.h);
          } catch {
            /* ignore */
          }
          ctx.globalAlpha = 1;
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

    // Structure outlines are opt-in (the "Bounds" toggle) so the preview stays clean.
    if (showBounds) {
      ctx.lineWidth = 1 / zoom;
      for (const item of layout.items) {
        if (item.guid === selectedGuid || item.guid === hover) continue;
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
    hi(hover, "rgba(201,162,39,0.6)", 1.5);
    hi(selectedGuid, "#c9a227", 2);

    ctx.restore();
  }, [doc, layout, view, size, selectedGuid, hover, getImage, showBounds, background]);

  // Interaction: pan background / move a component (changes offset) / zoom / select.
  type DragState =
    | { kind: "pan"; x: number; y: number; panX: number; panY: number; moved: boolean }
    | { kind: "move"; guid: string; startWX: number; startWY: number; offX: number; offY: number; moved: boolean };
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

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(8, Math.max(0.05, view.zoom * factor));
    // Keep point under cursor stable.
    const wx = (mx - view.panX) / view.zoom;
    const wy = (my - view.panY) / view.zoom;
    setView({ zoom: newZoom, panX: mx - wx * newZoom, panY: my - wy * newZoom });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    const guid = hitTest(w.x, w.y);
    if (guid) {
      // Grab a component: drag moves it (updates offset). Seed the offset from
      // its current position relative to the parent (works even with no offset
      // attr / docking, so it doesn't jump).
      const item = layout.items.find((i) => i.guid === guid);
      const parent = parentRectOf(guid) ?? layout.canvas;
      select(guid);
      if (item) {
        drag.current = {
          kind: "move",
          guid,
          startWX: w.x,
          startWY: w.y,
          offX: item.rect.x - parent.x,
          offY: item.rect.y - parent.y,
          moved: false,
        };
      }
    } else {
      drag.current = { kind: "pan", x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
    }
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
    } else {
      const w = toWorld(e.clientX, e.clientY);
      setHover(hitTest(w.x, w.y));
    }
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const d = drag.current;
    drag.current = null;
    // A pan that didn't move = a click on empty space → clear selection.
    if (d?.kind === "pan" && !d.moved) {
      const w = toWorld(e.clientX, e.clientY);
      select(hitTest(w.x, w.y));
    }
  };

  const fit = useCallback(() => {
    const cv = layout.canvas;
    const pad = 40;
    const zoom = Math.min((size.w - pad * 2) / cv.w, (size.h - pad * 2) / cv.h);
    setView({ zoom, panX: pad, panY: pad });
  }, [layout, size, setView]);

  useEffect(() => {
    // Auto-fit when a new document loads.
    if (doc) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const pickRoot = async () => {
    const dir = await open({ directory: true, defaultPath: dataRoot ?? undefined });
    if (typeof dir === "string") setDataRoot(dir);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="relative px-3 h-9 flex items-center gap-2 border-b border-edge shrink-0 bg-panel">
        <span className="font-semibold text-[12px]">Visualizer</span>
        <span className="text-[11px] text-gray-500">
          {layout.items.length} components · {layout.canvas.w}×{layout.canvas.h}
        </span>
        <div className="flex-1" />
        <button
          className={`px-2 py-0.5 rounded border border-edge text-[12px] leading-none ${
            showSettings ? "bg-accent/30 border-accent" : "bg-[#2a2d3a] hover:bg-[#343849]"
          }`}
          onClick={() => setShowSettings((s) => !s)}
          title="Settings"
        >
          ⚙
        </button>
        <button
          className="px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px]"
          onClick={fit}
        >
          Fit
        </button>
        <span className="text-[11px] text-gray-500 w-14 text-right">{Math.round(view.zoom * 100)}%</span>

        {showSettings && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
            <div className="absolute z-20 right-2 top-9 w-72 bg-panel border border-edge rounded shadow-lg p-3 text-[12px]">
              <div className="font-semibold mb-2">Settings</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">3K data root</div>
              <div className="text-[11px] text-gray-300 break-all mb-2">{dataRoot ?? "not set"}</div>
              <button
                className="px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px]"
                onClick={pickRoot}
              >
                Change…
              </button>
            </div>
          </>
        )}
      </div>
      <div ref={wrapRef} className="flex-1 min-h-0 relative overflow-hidden">
        {!doc && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-[13px]">
            Open a .twui.xml file to preview.
          </div>
        )}
        {doc && !dataRoot && (
          <div className="absolute top-2 left-2 right-2 text-[11px] text-amber-300/80 bg-amber-900/30 border border-amber-700/40 rounded px-2 py-1">
            3K data root not set — images won't load. Set it from the toolbar.
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            width: size.w,
            height: size.h,
            cursor: drag.current ? "grabbing" : hover ? "move" : "default",
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            drag.current = null;
            setHover(null);
          }}
        />
      </div>
      <BottomControls
        showBounds={showBounds}
        setShowBounds={setShowBounds}
        expanded={showPanel}
        onToggle={() => setShowPanel((p) => !p)}
      />
    </div>
  );
}

function BottomControls({
  showBounds,
  setShowBounds,
  expanded,
  onToggle,
}: {
  showBounds: boolean;
  setShowBounds: (updater: (b: boolean) => boolean) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const context = useStore((s) => s.context);
  const db = useStore((s) => s.contextDb);
  const setCampaign = useStore((s) => s.setCampaign);
  const setFaction = useStore((s) => s.setFaction);
  const setCulture = useStore((s) => s.setCulture);
  const setSubculture = useStore((s) => s.setSubculture);
  const backgrounds = useStore((s) => s.backgrounds);
  const background = useStore((s) => s.background);
  const setBackground = useStore((s) => s.setBackground);

  const sel = "w-full bg-[#15161c] border border-edge rounded text-[11px] px-1.5 py-0.5";
  const lbl = "text-[10px] text-gray-500 uppercase tracking-wide";

  const hasDb = !!db && db.factions.length > 0;
  const campaignFactionKeys = db?.campaign_factions[context.campaign];
  const factionOptions =
    campaignFactionKeys && campaignFactionKeys.length
      ? campaignFactionKeys
      : db?.factions.map((f) => f.key) ?? [];

  const cell = (label: string, children: ReactNode) => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={lbl}>{label}</span>
      {children}
    </div>
  );

  const textInput = (v: string, on: (s: string) => void) => (
    <input className={sel} value={v} onChange={(e) => on(e.target.value)} />
  );

  const selectFor = (value: string, onChange: (v: string) => void, options: string[]) => (
    <select className={sel} value={value} onChange={(e) => onChange(e.target.value)}>
      {!options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <div className="border-t border-edge bg-[#1a1b22] shrink-0">
      <div
        className="px-3 h-7 flex items-center gap-2 cursor-pointer select-none hover:bg-[#20222c]"
        onClick={onToggle}
      >
        <span className="text-gray-500 text-[10px]">{expanded ? "▾" : "▸"}</span>
        <span className="text-[11px] font-medium">View &amp; Perspective</span>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600">{expanded ? "hide" : "show"}</span>
      </div>
      {expanded && (
        <div className="grid grid-cols-3 gap-2 px-3 pb-3 pt-1">
          {cell(
            "Campaign",
            hasDb ? selectFor(context.campaign, setCampaign, db!.campaigns) : textInput(context.campaign, setCampaign)
          )}
          {cell(
            "Faction",
            hasDb ? selectFor(context.faction, setFaction, factionOptions) : textInput(context.faction, setFaction)
          )}
          {cell(
            "Culture",
            hasDb ? selectFor(context.culture, setCulture, db!.cultures) : textInput(context.culture, setCulture)
          )}
          {cell(
            "Subculture",
            hasDb
              ? selectFor(context.subculture, setSubculture, db!.subcultures.map((s) => s.subculture))
              : textInput(context.subculture, setSubculture)
          )}
          {cell(
            "Background",
            <select
              className={sel}
              value={background ?? ""}
              onChange={(e) => setBackground(e.target.value || null)}
            >
              <option value="">No background</option>
              {backgrounds.map((b) => (
                <option key={b} value={b}>
                  {b.replace(/^background\//, "")}
                </option>
              ))}
            </select>
          )}
          {cell(
            "Bounds",
            <button
              className={`w-full px-1.5 py-0.5 rounded border text-[11px] ${
                showBounds ? "bg-accent/30 border-accent" : "bg-[#15161c] border-edge hover:bg-[#23252f]"
              }`}
              onClick={() => setShowBounds((b) => !b)}
            >
              {showBounds ? "On" : "Off"}
            </button>
          )}
        </div>
      )}
    </div>
  );
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

function drawText(ctx: CanvasRenderingContext2D, item: { rect: Rect; text?: string; fontColour?: string; fontSize?: number; textHAlign?: string; textVAlign?: string }) {
  if (!item.text) return;
  const size = item.fontSize ?? 13;
  ctx.save();
  ctx.fillStyle = item.fontColour && item.fontColour[0] === "#" ? item.fontColour.slice(0, 7) : "#ffffff";
  ctx.font = `${size}px "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  const ha = item.textHAlign ?? "Left";
  ctx.textAlign = ha === "Center" ? "center" : ha === "Right" ? "right" : "left";
  const tx = ha === "Center" ? item.rect.x + item.rect.w / 2 : ha === "Right" ? item.rect.x + item.rect.w : item.rect.x;
  const ty = item.rect.y + item.rect.h / 2;
  ctx.fillText(item.text, tx, ty);
  ctx.restore();
}
