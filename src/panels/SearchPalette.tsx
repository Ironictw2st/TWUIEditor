import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { findReferences, searchComponents, SearchHit } from "../twui/search";

const MATCH_LABEL: Record<SearchHit["matchKind"], string> = {
  id: "id",
  tag: "tag",
  guid: "guid",
  text: "text",
  ref: "reference",
};

/** Quick-find palette: jump to a component by id/tag/guid/text, or list the
 *  components that reference the selected one. Keyboard-driven, read-only. */
export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.searchMode);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const select = useStore((s) => s.select);
  const openSearch = useStore((s) => s.openSearch);

  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const refsRef = useRef<HTMLDivElement | null>(null);

  // Keep a focused element so arrow/Enter/Esc work: the input in Find, the hint in Refs.
  useEffect(() => {
    if (mode === "refs") refsRef.current?.focus();
    else inputRef.current?.focus();
  }, [mode]);

  const results = useMemo<SearchHit[]>(() => {
    if (!doc) return [];
    return mode === "refs" ? findReferences(doc, selectedGuid ?? "") : searchComponents(doc, q);
  }, [doc, mode, q, selectedGuid]);

  useEffect(() => setHi(0), [q, mode, selectedGuid]);

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    select(hit.guid);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // don't trigger global shortcuts while typing
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[hi]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const toggle = (m: "find" | "refs", label: string, disabled?: boolean) => (
    <button
      className={`px-2 py-0.5 rounded text-[11px] border disabled:opacity-40 ${
        mode === m ? "bg-accent/30 border-accent" : "bg-[#2a2d3a] border-edge hover:bg-[#343849]"
      }`}
      disabled={disabled}
      onClick={() => openSearch(m)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-16 -translate-x-1/2 w-[560px] max-h-[70vh] flex flex-col bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-2 border-b border-edge bg-[#23252f]">
          <span className="font-semibold">Go to component</span>
          <div className="flex-1" />
          {toggle("find", "Find")}
          {toggle("refs", "References", !selectedGuid)}
          <button
            className="px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {mode === "find" ? (
          <div className="px-3 py-2 border-b border-edge">
            <input
              ref={inputRef}
              className="w-full"
              placeholder="search by id, tag, guid, or text…"
              spellCheck={false}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
        ) : (
          <div
            ref={refsRef}
            className="px-3 py-2 border-b border-edge text-[11px] text-gray-400 outline-none"
            onKeyDown={onKeyDown}
            tabIndex={0}
          >
            Components that reference the selected component.
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto py-1">
          {!doc ? (
            <div className="px-3 py-3 text-gray-500">Open a layout to search it.</div>
          ) : mode === "refs" && !selectedGuid ? (
            <div className="px-3 py-3 text-gray-500">Select a component first to find its references.</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-gray-500">No matches.</div>
          ) : (
            results.map((hit, i) => (
              <div
                key={hit.guid}
                className={`px-3 py-1 cursor-pointer ${i === hi ? "bg-accent/20" : "hover:bg-[#23252f]"}`}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(hit)}
              >
                <div className="flex items-baseline gap-2">
                  <span className={`text-[12px] truncate ${hit.hidden ? "opacity-50" : ""}`}>{hit.tag}</span>
                  {hit.id && <span className="text-[11px] text-gray-400 truncate">{hit.id}</span>}
                  <div className="flex-1" />
                  <span className="text-[10px] text-gray-600 shrink-0">{MATCH_LABEL[hit.matchKind]}</span>
                </div>
                <div className="text-[10px] text-gray-600 truncate">
                  {hit.guid}
                  {hit.text ? `  ·  ${hit.text}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
