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
import { hiddenGuids } from "../twui/visibility";
import { useLayoutInputs } from "../state/useLayoutInputs";
import { mouseModifierHeld, multiSelectBinding } from "../keybinds";
import { RawElement } from "../types/twui";

function isHidden(comp: RawElement | undefined): boolean {
  return (
    !!comp &&
    (getAttr(comp, "visible") === "false" || getAttr(comp, "is_visible") === "false")
  );
}

type DropHint = "none" | "before" | "after" | "into";

function Row({
  node,
  parentGuid,
  nextGuid,
  depth,
  expanded,
  toggle,
  expand,
  compMap,
  ancestorHidden,
  inheriting,
  hidden,
  draggingGuid,
  setDraggingGuid,
}: {
  node: RawElement;
  parentGuid: string | null;
  nextGuid: string | null;
  depth: number;
  expanded: Set<string>;
  toggle: (g: string) => void;
  expand: (g: string) => void;
  compMap: Map<string, RawElement>;
  ancestorHidden: boolean;
  inheriting: Set<string>;
  hidden: Set<string>;
  draggingGuid: string | null;
  setDraggingGuid: (g: string | null) => void;
}) {
  const guid = guidOf(node) ?? "";
  const kids = elementChildren(node);
  const selected = useStore((s) => s.selectedGuids.includes(guid));
  const hovered = useStore((s) => s.hoveredGuid === guid);
  const setHovered = useStore((s) => s.setHovered);
  const select = useStore((s) => s.select);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const keybinds = useStore((s) => s.settings.keybinds);
  const move = useStore((s) => s.move);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const setRevealed = useStore((s) => s.setRevealed);
  const isRevealed = useStore((s) => s.revealed[guid] === true);
  const isOpen = expanded.has(guid);

  // Visibility sources: static `visible="false"` vs a script/context binding. A script-hidden
  // node can be force-revealed from here (non-destructive); a revealed one is no longer dimmed.
  const ownStaticHidden = isHidden(compMap.get(guid));
  const scriptHidden = hidden.has(guid);
  const ownHidden = ownStaticHidden || (scriptHidden && !isRevealed);
  const dimmed = ownHidden || ancestorHidden;

  const [dropHint, setDropHint] = useState<DropHint>("none");

  const onDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/guid", guid);
    e.dataTransfer.effectAllowed = "move";
    setDraggingGuid(guid);
  };
  const onDragEnd = () => setDraggingGuid(null);
  const onDragOver = (e: React.DragEvent) => {
    // Can't drop onto the node being dragged.
    if (draggingGuid === guid) return;
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientY - r.top) / Math.max(1, r.height);
    // Top/bottom thirds reorder among siblings; the middle reparents. The root has no parent,
    // so it only accepts "into".
    const hint: DropHint = !parentGuid ? "into" : frac < 0.3 ? "before" : frac > 0.7 ? "after" : "into";
    setDropHint(hint);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragged = e.dataTransfer.getData("text/guid");
    const hint = dropHint;
    setDropHint("none");
    setDraggingGuid(null);
    if (!dragged || dragged === guid) return;
    if (hint === "before" && parentGuid) move(dragged, parentGuid, guid);
    else if (hint === "after" && parentGuid) move(dragged, parentGuid, nextGuid);
    else {
      move(dragged, guid, null); // reparent as a child
      expand(guid);
    }
  };

  return (
    <div>
      <div
        data-guid={guid}
        className={`relative flex items-center gap-1 pr-1 cursor-pointer rounded select-none ${
          dropHint === "into"
            ? "ring-1 ring-accent bg-drop"
            : selected
            ? "bg-selected outline outline-1 outline-accent"
            : hovered
            ? "bg-panelHeader ring-1 ring-accent/40"
            : "hover:bg-panelHeader"
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
        draggable
        onMouseEnter={() => setHovered(guid)}
        onMouseLeave={() => setHovered(null)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint("none")}
        onDrop={onDrop}
        onClick={(e) => {
          e.stopPropagation();
          if (mouseModifierHeld(e, multiSelectBinding(keybinds))) toggleSelect(guid);
          else select(guid);
        }}
      >
        {dropHint === "before" && (
          <div className="absolute -top-px left-0 right-0 h-0.5 bg-accent z-10" />
        )}
        {dropHint === "after" && (
          <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-accent z-10" />
        )}
        <span
          className="w-4 shrink-0 text-center text-gray-500"
          onClick={(e) => {
            e.stopPropagation();
            if (kids.length) toggle(guid);
          }}
        >
          {kids.length ? (isOpen ? "▾" : "▸") : ""}
        </span>
        <span className={`text-[12px] truncate min-w-0 mr-auto ${dimmed ? "opacity-50" : ""}`}>
          {node.tag}
        </span>
        {inheriting.has(guid) && (
          <span className="shrink-0 text-[10px] text-gray-500 opacity-70" title="Inherits context from a parent">
            ⛓
          </span>
        )}
        <span
          className={`w-4 text-center shrink-0 ${
            isRevealed ? "text-accent opacity-100" : ownHidden ? "" : "opacity-60 hover:opacity-100"
          }`}
          title={
            scriptHidden && !ownStaticHidden
              ? isRevealed
                ? "Forced visible (overriding script) — click to hide again"
                : "Hidden by a script binding — click to force visible"
              : ownHidden
              ? "Show (remove visible=\"false\")"
              : "Hide (set visible=\"false\")"
          }
          onClick={(e) => {
            e.stopPropagation();
            if (!guid) return;
            // Script/context-hidden nodes get a non-destructive force-show toggle; statically
            // hidden/visible nodes keep editing the `visible` attribute.
            if (scriptHidden && !ownStaticHidden) setRevealed(guid, !isRevealed);
            else toggleVisible(guid);
          }}
        >
          {ownHidden ? "🚫" : "👁"}
        </span>
      </div>
      {isOpen &&
        kids.map((k, i) => (
          <Row
            key={guidOf(k)}
            node={k}
            parentGuid={guid}
            nextGuid={(i + 1 < kids.length ? guidOf(kids[i + 1]) : null) ?? null}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            expand={expand}
            compMap={compMap}
            ancestorHidden={dimmed}
            inheriting={inheriting}
            hidden={hidden}
            draggingGuid={draggingGuid}
            setDraggingGuid={setDraggingGuid}
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

  const openSearch = useStore((s) => s.openSearch);

  const root = useMemo(() => (doc ? hierarchyRoot(doc) : undefined), [doc]);
  const compMap = useMemo(
    () => (doc ? componentMap(doc) : new Map<string, RawElement>()),
    [doc]
  );
  const inheriting = useMemo(() => (doc ? inheritingGuids(doc) : new Set<string>()), [doc]);
  // Guids hidden by a script/context binding (evaluated like the canvas does), so the tree
  // dims them — and their subtree — exactly like a static visible="false" node.
  const { dataPack, staticVars, tokens, context, ccoShorthand } = useLayoutInputs();
  const hidden = useMemo(
    () =>
      doc
        ? hiddenGuids(doc, { dataPack, vars: staticVars, shorthand: ccoShorthand ?? undefined }, context, tokens)
        : new Set<string>(),
    [doc, dataPack, staticVars, ccoShorthand, context, tokens]
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggingGuid, setDraggingGuid] = useState<string | null>(null);
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

  const expand = (g: string) =>
    setExpanded((prev) => (prev.has(g) ? prev : new Set(prev).add(g)));

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

  const btn = "px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px] disabled:opacity-40";

  return (
    <>
      <div className="px-3 h-9 flex items-center gap-1.5 border-b border-edge shrink-0">
        <span className="font-semibold text-[12px] mr-auto">Hierarchy</span>
        <button className={btn} onClick={() => openSearch("find")} disabled={!doc} title="Go to component (Ctrl+P)">
          Find
        </button>
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
            nextGuid={null}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            expand={expand}
            compMap={compMap}
            ancestorHidden={false}
            inheriting={inheriting}
            hidden={hidden}
            draggingGuid={draggingGuid}
            setDraggingGuid={setDraggingGuid}
          />
        ) : (
          <div className="text-gray-500 text-[12px] p-3">Open a .twui.xml file to begin.</div>
        )}
      </div>
    </>
  );
}
