import { useState } from "react";
import { useStore } from "../state/store";
import { useContextMenu, MenuItem } from "../components/ContextMenu";

/** The file-switcher strip at the top of the Hierarchy panel. One tab per open `.twui.xml`;
 *  click to switch the active file (every panel follows it), the `x` to close it. A `*` marks
 *  unsaved edits. Drag a tab to reorder it (which also reorders the layer z-order — tab order
 *  IS the stack order). Renders nothing until at least one file is open. */
export default function FileTabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);
  const reorderLayer = useStore((s) => s.reorderLayer);
  const openFileDialog = useStore((s) => s.openFileDialog);
  const menu = useContextMenu();

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overBefore, setOverBefore] = useState(true); // drop left of (true) or right of the target

  // Tabs render in array order (index 0 = leftmost = bottom layer), so the drop index maps
  // straight to `reorderLayer` without reversing.
  const onDropTab = (targetId: string) => {
    const dragged = dragId;
    setDragId(null);
    setOverId(null);
    if (!dragged || dragged === targetId) return;
    const ids = tabs.map((t) => t.id).filter((id) => id !== dragged);
    const tIdx = ids.indexOf(targetId);
    if (tIdx < 0) return;
    ids.splice(overBefore ? tIdx : tIdx + 1, 0, dragged);
    reorderLayer(dragged, ids.indexOf(dragged));
  };

  // Right-click a tab: save/close that file (saving a non-active tab switches to it first) and
  // toggle whether it composites as a layer.
  const tabMenu = (id: string, visible: boolean): MenuItem[] => {
    const active = id === activeTabId;
    const s = useStore.getState();
    const saveTab = (saveAs: boolean) => {
      if (!active) s.switchTab(id);
      void (saveAs ? s.saveAsDialog() : s.save());
    };
    return [
      { label: "Save", onSelect: () => saveTab(false) },
      { label: "Save As…", onSelect: () => saveTab(true) },
      { label: "", separator: true },
      {
        label: active ? "Shown (active file)" : visible ? "Hide layer" : "Show as layer",
        disabled: active,
        onSelect: () => s.setLayerVisible(id, !visible),
      },
      { label: "", separator: true },
      { label: "Close", onSelect: () => s.closeTab(id) },
      { label: "Close Others", disabled: tabs.length < 2, onSelect: () => tabs.forEach((t) => t.id !== id && s.closeTab(t.id)) },
      { label: "Close All", onSelect: () => tabs.forEach((t) => s.closeTab(t.id)) },
    ];
  };

  if (tabs.length === 0) return null;

  return (
    <>
    <div className="flex items-stretch gap-px overflow-x-auto border-b border-edge shrink-0 bg-sunken">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        const isOver = overId === t.id && dragId && dragId !== t.id;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => switchTab(t.id)}
            onContextMenu={(e) => menu.open(e, tabMenu(t.id, t.visible))}
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
              setOverBefore((e.clientX - r.left) / Math.max(1, r.width) < 0.5);
            }}
            onDragLeave={() => setOverId((cur) => (cur === t.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              onDropTab(t.id);
            }}
            className={`group relative flex items-center gap-1 pl-2 pr-1 h-7 max-w-[160px] cursor-pointer text-[11px] border-r border-edge ${
              active ? "bg-panel text-text" : "bg-sunken text-textMuted hover:bg-panelHeader"
            }`}
          >
            {isOver && (
              <div className={`absolute top-0 bottom-0 w-0.5 bg-accent z-10 ${overBefore ? "left-0" : "right-0"}`} />
            )}
            <span className="truncate">{t.fileName ?? "(untitled)"}</span>
            {t.dirty && <span className="text-amber-300/80 shrink-0">*</span>}
            <button
              className="shrink-0 w-4 h-4 leading-none rounded text-textMuted hover:bg-button hover:text-text opacity-60 group-hover:opacity-100"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="shrink-0 px-2 h-7 text-[13px] leading-none text-textMuted hover:bg-panelHeader hover:text-text"
        title="Open another file in a new tab"
        onClick={() => void openFileDialog()}
      >
        +
      </button>
    </div>
    {menu.element}
    </>
  );
}
