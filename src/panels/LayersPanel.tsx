import { useState } from "react";
import { useStore } from "../state/store";
import { useContextMenu, MenuItem } from "../components/ContextMenu";

/** Eye icon (open = the layer is composited, slashed = hidden). */
function EyeIcon({ on }: { on: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Drag grip (six dots) — the whole row is draggable, this just signals it. */
function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      <circle cx="2.5" cy="2.5" r="1.2" />
      <circle cx="7.5" cy="2.5" r="1.2" />
      <circle cx="2.5" cy="7" r="1.2" />
      <circle cx="7.5" cy="7" r="1.2" />
      <circle cx="2.5" cy="11.5" r="1.2" />
      <circle cx="7.5" cy="11.5" r="1.2" />
    </svg>
  );
}

/** The layer stack: every open file is a layer, composited together in the visualizer. Listed
 *  top-layer-first (matching the draw order: the topmost entry draws on top). An eye toggles
 *  whether a file is composited (the active/edited file always renders); drag to reorder the
 *  z-order; click a row to make that file the active (editable) one. */
export default function LayersPanel() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const switchTab = useStore((s) => s.switchTab);
  const setLayerVisible = useStore((s) => s.setLayerVisible);
  const reorderLayer = useStore((s) => s.reorderLayer);
  const closeTab = useStore((s) => s.closeTab);
  const menu = useContextMenu();

  const rowMenu = (id: string, visible: boolean, active: boolean): MenuItem[] => [
    { label: "Make Active", disabled: active, onSelect: () => switchTab(id) },
    { label: active ? "Shown (active file)" : visible ? "Hide Layer" : "Show Layer", disabled: active, onSelect: () => setLayerVisible(id, !visible) },
    { label: "", separator: true },
    { label: "Move to Top", onSelect: () => reorderLayer(id, tabs.length - 1) },
    { label: "Move to Bottom", onSelect: () => reorderLayer(id, 0) },
    { label: "", separator: true },
    { label: "Close Layer", onSelect: () => closeTab(id) },
  ];

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overBefore, setOverBefore] = useState(true); // drop above (true) or below the target row

  // Top layer first (last in `tabs` = top of the composite).
  const display = [...tabs].reverse();

  const onDrop = (targetId: string) => {
    const dragged = dragId;
    setDragId(null);
    setOverId(null);
    if (!dragged || dragged === targetId) return;
    // Work in display order (top-first), then map back to `tabs` (bottom-first) for the z-index.
    const ids = display.map((t) => t.id).filter((id) => id !== dragged);
    const tIdx = ids.indexOf(targetId);
    if (tIdx < 0) return;
    ids.splice(overBefore ? tIdx : tIdx + 1, 0, dragged);
    const newOrder = ids.reverse(); // back to bottom-first
    reorderLayer(dragged, newOrder.indexOf(dragged));
  };

  if (tabs.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-textMuted">No files open.</div>;
  }

  return (
    <div className="flex flex-col text-[11px]">
      {display.map((t) => {
        const active = t.id === activeTabId;
        const isOver = overId === t.id && dragId && dragId !== t.id;
        return (
          <div
            key={t.id}
            role="button"
            aria-current={active}
            onClick={() => switchTab(t.id)}
            onContextMenu={(e) => menu.open(e, rowMenu(t.id, t.visible, active))}
            title={t.filePath ?? t.packPath ?? t.fileName ?? undefined}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragId(t.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === t.id) return;
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setOverId(t.id);
              setOverBefore((e.clientY - r.top) / Math.max(1, r.height) < 0.5);
            }}
            onDragLeave={() => setOverId((cur) => (cur === t.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(t.id);
            }}
            className={`group relative flex items-center gap-1.5 pl-1 pr-2 h-7 cursor-pointer border-b border-edge/60 ${
              active ? "bg-selected text-text" : "bg-panel text-textMuted hover:bg-panelHeader"
            } ${isOver ? (overBefore ? "shadow-[inset_0_2px_0_0_var(--tw-shadow-color)] shadow-accent" : "shadow-[inset_0_-2px_0_0_var(--tw-shadow-color)] shadow-accent") : ""}`}
          >
            <span className="shrink-0 text-textMuted/50 cursor-grab active:cursor-grabbing">
              <GripIcon />
            </span>
            <button
              className={`shrink-0 w-5 h-5 grid place-items-center rounded ${
                active
                  ? "text-accent cursor-default"
                  : t.visible
                    ? "text-accent hover:bg-button"
                    : "text-textMuted/50 hover:bg-button hover:text-text"
              }`}
              title={active ? "Active file (always shown)" : t.visible ? "Hide layer" : "Show layer"}
              onClick={(e) => {
                e.stopPropagation();
                if (active) return; // the edited file always renders
                setLayerVisible(t.id, !t.visible);
              }}
            >
              <EyeIcon on={active || t.visible} />
            </button>
            <span className="truncate flex-1">{t.fileName ?? "(untitled)"}</span>
            {t.dirty && <span className="text-amber-300/80 shrink-0">*</span>}
          </div>
        );
      })}
      {menu.element}
    </div>
  );
}
