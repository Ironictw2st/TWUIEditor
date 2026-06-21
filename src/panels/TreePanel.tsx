import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import {
  ancestorGuids,
  componentMap,
  elementChildren,
  getAttr,
  guidOf,
  hierarchyRoot,
} from "../twui/doc";
import { inheritingGuids } from "../twui/inherit";
import { RawElement } from "../types/twui";

function isHidden(comp: RawElement | undefined): boolean {
  return (
    !!comp &&
    (getAttr(comp, "visible") === "false" || getAttr(comp, "is_visible") === "false")
  );
}

function Row({
  node,
  parentGuid,
  depth,
  expanded,
  toggle,
  compMap,
  ancestorHidden,
  inheriting,
}: {
  node: RawElement;
  parentGuid: string | null;
  depth: number;
  expanded: Set<string>;
  toggle: (g: string) => void;
  compMap: Map<string, RawElement>;
  ancestorHidden: boolean;
  inheriting: Set<string>;
}) {
  const guid = guidOf(node) ?? "";
  const kids = elementChildren(node);
  const selected = useStore((s) => s.selectedGuid === guid);
  const select = useStore((s) => s.select);
  const move = useStore((s) => s.move);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const isOpen = expanded.has(guid);

  const ownHidden = isHidden(compMap.get(guid));
  const dimmed = ownHidden || ancestorHidden;

  const [dropHint, setDropHint] = useState<"none" | "into" | "before">("none");

  const onDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/guid", guid);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropHint(e.clientY - r.top < 6 ? "before" : "into");
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragged = e.dataTransfer.getData("text/guid");
    setDropHint("none");
    if (!dragged || dragged === guid) return;
    if (dropHint === "before" && parentGuid) move(dragged, parentGuid, guid);
    else move(dragged, guid, null);
  };

  return (
    <div>
      <div
        data-guid={guid}
        className={`relative flex items-center gap-1 pr-1 cursor-pointer rounded select-none ${
          selected ? "bg-[#3b3a1f] outline outline-1 outline-accent" : "hover:bg-[#23252f]"
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint("none")}
        onDrop={onDrop}
        onClick={(e) => {
          e.stopPropagation();
          select(guid);
        }}
      >
        {dropHint === "before" && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
        )}
        <span
          className="w-4 text-center text-gray-500"
          onClick={(e) => {
            e.stopPropagation();
            if (kids.length) toggle(guid);
          }}
        >
          {kids.length ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <span
          className={`text-[12px] truncate mr-auto ${dimmed ? "opacity-50" : ""} ${
            dropHint === "into" ? "bg-[#2c3d2c] rounded px-1" : ""
          }`}
        >
          {node.tag}
        </span>
        {inheriting.has(guid) && (
          <span className="shrink-0 text-[10px] text-gray-500 opacity-70" title="Inherits context from a parent">
            ⛓
          </span>
        )}
        <span
          className={`w-4 text-center shrink-0 ${ownHidden ? "" : "opacity-60 hover:opacity-100"}`}
          title={ownHidden ? "Show (remove visible=\"false\")" : "Hide (set visible=\"false\")"}
          onClick={(e) => {
            e.stopPropagation();
            if (guid) toggleVisible(guid);
          }}
        >
          {ownHidden ? "🚫" : "👁"}
        </span>
      </div>
      {isOpen &&
        kids.map((k) => (
          <Row
            key={guidOf(k)}
            node={k}
            parentGuid={guid}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            compMap={compMap}
            ancestorHidden={dimmed}
            inheriting={inheriting}
          />
        ))}
    </div>
  );
}

export default function TreePanel() {
  const doc = useStore((s) => s.doc);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const addChild = useStore((s) => s.addChild);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const deleteSelected = useStore((s) => s.deleteSelected);

  const root = useMemo(() => (doc ? hierarchyRoot(doc) : undefined), [doc]);
  const compMap = useMemo(
    () => (doc ? componentMap(doc) : new Map<string, RawElement>()),
    [doc]
  );
  const inheriting = useMemo(() => (doc ? inheritingGuids(doc) : new Set<string>()), [doc]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reveal the selected node: expand its ancestors so its branch is open.
  useEffect(() => {
    if (!doc || !selectedGuid) return;
    const ancestors = ancestorGuids(doc, selectedGuid);
    if (!ancestors.length) return;
    setExpanded((prev) => {
      if (ancestors.every((g) => prev.has(g))) return prev;
      const next = new Set(prev);
      ancestors.forEach((g) => next.add(g));
      return next;
    });
  }, [selectedGuid, doc]);

  // Scroll the selected row into view once its branch has expanded.
  useEffect(() => {
    if (!selectedGuid) return;
    const el = scrollRef.current?.querySelector(
      `[data-guid="${CSS.escape(selectedGuid)}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedGuid, expanded]);

  const toggle = (g: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const expandAll = () => {
    if (!root) return;
    const all = new Set<string>();
    const walk = (n: RawElement) => {
      const g = guidOf(n);
      if (g) all.add(g);
      elementChildren(n).forEach(walk);
    };
    walk(root);
    setExpanded(all);
  };

  const btn = "px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px] disabled:opacity-40";

  return (
    <>
      <div className="px-3 h-9 flex items-center gap-1.5 border-b border-edge shrink-0">
        <span className="font-semibold text-[12px] mr-auto">Hierarchy</span>
        <button className={btn} onClick={expandAll}>
          Expand
        </button>
        <button className={btn} onClick={() => setExpanded(new Set())}>
          Collapse
        </button>
      </div>
      <div className="px-2 py-1.5 flex gap-1.5 border-b border-edge shrink-0">
        <button
          className={btn}
          disabled={!selectedGuid}
          onClick={() => selectedGuid && addChild(selectedGuid, "new_component")}
        >
          + Child
        </button>
        <button className={btn} disabled={!selectedGuid} onClick={duplicateSelected}>
          Duplicate
        </button>
        <button className={btn} disabled={!selectedGuid} onClick={deleteSelected}>
          Delete
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto py-1">
        {root ? (
          <Row
            node={root}
            parentGuid={null}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            compMap={compMap}
            ancestorHidden={false}
            inheriting={inheriting}
          />
        ) : (
          <div className="text-gray-500 text-[12px] p-3">Open a .twui.xml file to begin.</div>
        )}
      </div>
    </>
  );
}
