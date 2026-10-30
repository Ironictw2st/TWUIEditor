// The floating tooltip shown in Tooltip mode. Text tooltips render the game's rich text
// (`[[col]]`, `[[b]]`, `[[i]]`, `[[img]]`, `Title||Body`) in a game-like dark panel; a
// `{{tt:<layout>}}` tooltip loads that layout (plus its templates) and paints it with the
// visualizer's own scene painter into a small canvas, falling back to the static text.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutResult, Rect } from "../layout/compute";
import type { TwuiDocument } from "../types/twui";
import { imageUrl, loadLayouts, loadTemplates } from "../ipc/commands";
import { collectTemplateIds } from "../twui/template";
import { isImageRun, MarkupTables, parseMarkup, Run } from "../twui/richText";
import type { TooltipResult } from "../twui/tooltip";

export interface TipLayout {
  doc: TwuiDocument;
  templates: Record<string, TwuiDocument>;
}

// Per data-source cache of loaded tooltip layouts (null = not found).
const tipLayouts = new Map<string, Promise<TipLayout | null>>();
function loadTipLayout(path: string, epoch: string | number): Promise<TipLayout | null> {
  const key = `${epoch}|${path}`;
  let p = tipLayouts.get(key);
  if (!p) {
    p = (async () => {
      try {
        const doc = (await loadLayouts([path]))[path];
        if (!doc) return null;
        const ids = collectTemplateIds(doc);
        const templates = ids.length ? await loadTemplates(ids).catch(() => ({})) : {};
        return { doc, templates };
      } catch {
        return null;
      }
    })();
    tipLayouts.set(key, p);
  }
  return p;
}

function RichRuns({ runs, epoch }: { runs: Run[]; epoch: string | number }) {
  return (
    <>
      {runs.map((r, i) =>
        isImageRun(r) ? (
          <img
            key={i}
            src={imageUrl(r.img, epoch)}
            alt=""
            className="inline-block align-text-bottom"
            style={{ height: "1.25em", width: "auto", margin: "0 1px" }}
          />
        ) : (
          <span
            key={i}
            style={{
              color: r.colour,
              fontWeight: r.bold ? 700 : undefined,
              fontStyle: r.italic ? "italic" : undefined,
            }}
          >
            {r.text}
          </span>
        )
      )}
    </>
  );
}

function TextTip({ tip, tables, epoch }: { tip: Extract<TooltipResult, { kind: "text" }>; tables: MarkupTables; epoch: string | number }) {
  const title = useMemo(() => (tip.title ? parseMarkup(tip.title, tables) : null), [tip.title, tables]);
  const body = useMemo(() => parseMarkup(tip.text, tables), [tip.text, tables]);
  return (
    <>
      {title && (
        <div className="font-semibold text-[12px] pb-1 mb-1 border-b border-white/15" style={{ color: "#E8D8A8" }}>
          <RichRuns runs={title} epoch={epoch} />
        </div>
      )}
      {body.length > 0 && <RichRuns runs={body} epoch={epoch} />}
    </>
  );
}

const MAX_TIP = 420;

function LayoutTip({
  tl,
  compute,
  paint,
  tick,
}: {
  tl: TipLayout;
  compute: (tl: TipLayout) => LayoutResult;
  paint: (ctx: CanvasRenderingContext2D, layout: LayoutResult) => void;
  tick: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const layout = useMemo(() => compute(tl), [tl, compute]);
  // Tight bounds of what the tooltip actually draws (its root may sit anywhere on the canvas).
  const bounds: Rect | null = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of layout.items) {
      const r = it.rect;
      if (!it.visible || r.w <= 0 || r.h <= 0) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return x0 < x1 && y0 < y1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }, [layout]);
  const scale = bounds ? Math.min(1, MAX_TIP / bounds.w, MAX_TIP / bounds.h) : 1;

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx || !bounds) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
    paint(ctx, layout);
  }, [layout, bounds, scale, paint, tick]);

  if (!bounds) return null;
  return <canvas ref={ref} width={Math.ceil(bounds.w * scale)} height={Math.ceil(bounds.h * scale)} className="block" />;
}

export default function TooltipBox({
  tip,
  x,
  y,
  tables,
  epoch,
  computeLayout,
  paint,
  tick,
}: {
  tip: TooltipResult;
  x: number;
  y: number;
  tables: MarkupTables;
  epoch: string | number;
  /** Lay out a loaded tooltip layout in the current preview context. */
  computeLayout: (tl: TipLayout) => LayoutResult;
  /** The visualizer's scene painter (images + text, no surface). */
  paint: (ctx: CanvasRenderingContext2D, layout: LayoutResult) => void;
  /** Bumps when images finish loading, to repaint the layout canvas. */
  tick: number;
}) {
  const path = tip.kind === "layout" ? tip.path : null;
  const [tl, setTl] = useState<{ path: string; value: TipLayout | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    loadTipLayout(path, epoch).then((value) => live && setTl({ path, value }));
    return () => {
      live = false;
    };
  }, [path, epoch]);

  let body: React.ReactNode = null;
  if (tip.kind === "text") body = <TextTip tip={tip} tables={tables} epoch={epoch} />;
  else if (tl && tl.path === tip.path && tl.value)
    body = <LayoutTip tl={tl.value} compute={computeLayout} paint={paint} tick={tick} />;
  else if (tl && tl.path === tip.path && tip.fallback?.kind === "text")
    body = <TextTip tip={tip.fallback} tables={tables} epoch={epoch} />;
  else if (tl && tl.path === tip.path)
    body = <span className="italic opacity-70">{`tooltip layout not found: ${tip.path}`}</span>;
  else body = <span className="italic opacity-70">{`loading ${tip.path}...`}</span>;

  const layoutBody = tip.kind === "layout" && tl?.value && tl.path === tip.path;
  return (
    <div
      className={
        "fixed z-40 pointer-events-none shadow-lg rounded-sm border text-[11px] leading-snug whitespace-pre-wrap " +
        (layoutBody ? "p-0 border-transparent" : "max-w-[350px] px-2.5 py-1.5")
      }
      style={{
        left: x + 14,
        top: y + 14,
        // Game tooltips: near-black translucent panel, warm off-white body text.
        background: layoutBody ? undefined : "rgba(14,12,10,0.94)",
        borderColor: layoutBody ? undefined : "rgba(200,175,110,0.45)",
        color: "#E6E1D6",
      }}
    >
      {body}
    </div>
  );
}
