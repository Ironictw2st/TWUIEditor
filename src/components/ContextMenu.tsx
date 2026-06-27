import { useLayoutEffect, useRef, useState, useEffect } from "react";

/** One entry in a context menu. `separator: true` renders a divider (label ignored); `submenu`
 *  makes it a parent that opens a nested menu on hover. */
export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
}

/** One menu surface, used for both the root menu and any nested submenu. Positions itself at
 *  `(x, y)` and flips to stay on-screen — horizontally toward `altX` (a submenu's parent left
 *  edge) when provided, else back by its own width. Selecting any leaf calls the shared
 *  `onClose`, so the whole stack dismisses. */
function MenuPanel({
  items,
  x,
  y,
  altX,
  onClose,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  altX?: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; x: number; altX: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 4;
    const overflowsRight = x + width > window.innerWidth - pad;
    const nx = overflowsRight ? Math.max(pad, (altX ?? x) - width) : x;
    const ny = y + height > window.innerHeight - pad ? Math.max(pad, y - height) : y;
    setPos({ x: nx, y: ny });
  }, [x, y, altX, items]);

  const openSubFor = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSub({ index: i, x: r.right - 2, altX: r.left, y: r.top - 4 });
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[160px] max-w-[280px] rounded-md bg-sunken border border-edge shadow-xl p-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="my-1 border-t border-edge/70" />;
        const hasSub = !!it.submenu?.length;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            className={`w-full flex items-center text-left px-2 py-1 rounded text-[11px] ${
              it.disabled
                ? "text-textMuted/40 cursor-default"
                : it.danger
                  ? "text-red-400 hover:bg-red-500/15"
                  : "text-text hover:bg-panelHeader"
            }`}
            onMouseEnter={(e) => {
              if (hasSub && !it.disabled) openSubFor(i, e.currentTarget);
              else setSub(null);
            }}
            onClick={(e) => {
              if (it.disabled) return;
              if (hasSub) {
                openSubFor(i, e.currentTarget); // also open on click (touch / no-hover)
                return;
              }
              it.onSelect?.();
              onClose();
            }}
          >
            <span className="truncate">{it.label}</span>
            {hasSub && <span className="ml-auto pl-3 text-textMuted">›</span>}
          </button>
        );
      })}
      {sub && items[sub.index]?.submenu && (
        <MenuPanel items={items[sub.index].submenu!} x={sub.x} y={sub.y} altX={sub.altX} onClose={onClose} />
      )}
    </div>
  );
}

/** A cursor-positioned context menu shared by every panel. Closes on outside click, Escape,
 *  scroll, or blur. Matches the app's dropdown styling (see the Panels menu in App.tsx). */
function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  // Close on Escape / scroll / window blur (outside click is handled by the overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <>
      {/* Full-screen catcher: any click (incl. right-click) dismisses. */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <MenuPanel items={items} x={x} y={y} onClose={onClose} />
    </>
  );
}

/** Hook: one per panel. Spread `onContextMenu={(e) => menu.open(e, items)}` on rows, and render
 *  `{menu.element}` once. Local state, so it works unchanged inside popped-out panel windows. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  };
  const element = state ? <ContextMenu x={state.x} y={state.y} items={state.items} onClose={() => setState(null)} /> : null;
  return { open, element };
}
