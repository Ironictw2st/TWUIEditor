import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";
import { readLayout, readLayoutRel } from "../ipc/commands";
import { componentMap, elementChildren, getAttr, guidOf, hierarchyRoot } from "../twui/doc";
import type { RawElement, TwuiDocument } from "../types/twui";

/** One row of the source document's hierarchy (read-only, single-select). The hierarchy node's tag
 *  is the component id (e.g. `pointer_arrow`), so it doubles as the label. */
function ForeignNode({
  node,
  depth,
  picked,
  onPick,
}: {
  node: RawElement;
  depth: number;
  picked: string | null;
  onPick: (guid: string) => void;
}) {
  const guid = guidOf(node);
  const kids = elementChildren(node);
  const [open, setOpen] = useState(depth < 2);
  const isPicked = guid != null && guid === picked;
  const pad = { paddingLeft: `${depth * 12 + 4}px` };

  return (
    <div>
      <div className="flex items-center" style={pad}>
        <button
          className="w-3 shrink-0 text-textMuted text-[11px]"
          onClick={() => setOpen((o) => !o)}
          tabIndex={-1}
        >
          {kids.length ? (open ? "▾" : "▸") : ""}
        </button>
        <button
          className={`flex-1 text-left px-1 py-0.5 text-[12px] rounded truncate ${
            isPicked ? "bg-accent/25 text-accent" : "text-text hover:bg-panelHeader"
          }`}
          title={guid ?? undefined}
          onClick={() => guid && onPick(guid)}
          disabled={!guid}
        >
          {node.tag}
        </button>
      </div>
      {open && kids.map((k, i) => <ForeignNode key={guidOf(k) ?? i} node={k} depth={depth + 1} picked={picked} onPick={onPick} />)}
    </div>
  );
}

/** Modal that inserts a component subtree from another `.twui.xml` into the active document.
 *  Rendered by App only while `insertOpen` is set, so it mounts fresh each time. */
export default function InsertFromFileDialog() {
  const close = useStore((s) => s.closeInsertDialog);
  const insertSource = useStore((s) => s.insertSource);
  const insertSubtreeFrom = useStore((s) => s.insertSubtreeFrom);
  const layouts = useStore((s) => s.packLayouts);
  const activeDoc = useStore((s) => s.doc);
  const selectedGuid = useStore((s) => s.selectedGuid);

  const [sourceDoc, setSourceDoc] = useState<TwuiDocument | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSource = async (path: string, fromPack: boolean) => {
    setLoading(true);
    setError(null);
    setPicked(null);
    setSourceDoc(null);
    try {
      const doc = fromPack ? await readLayoutRel(path) : await readLayout(path);
      setSourceDoc(doc);
      setSourcePath(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Auto-load a pre-seeded source (e.g. opened from the Pack Files menu).
  useEffect(() => {
    if (insertSource) void loadSource(insertSource, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? layouts.filter((p) => p.toLowerCase().includes(q)) : layouts;
    return list.slice(0, 600);
  }, [query, layouts]);

  const root = sourceDoc ? hierarchyRoot(sourceDoc) : undefined;

  // Where the inserted subtree lands in the active doc: under the selected component, else root.
  const targetName = useMemo(() => {
    if (!activeDoc) return null;
    if (!selectedGuid) return "root (top level)";
    const el = componentMap(activeDoc).get(selectedGuid);
    return el ? (getAttr(el, "id") ?? el.tag) : "selected component";
  }, [activeDoc, selectedGuid]);

  const browse = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "TWUI Layout", extensions: ["xml"] }] });
    if (typeof f === "string") void loadSource(f, false);
  };

  const doInsert = () => {
    if (!sourceDoc || !picked) return;
    void insertSubtreeFrom(sourceDoc, picked, selectedGuid ?? undefined);
    close();
  };

  const btn = "px-3 py-1.5 rounded border border-edge text-[12px]";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="w-[760px] h-[560px] rounded-lg bg-panel border border-edge shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-edge text-[13px] font-medium text-text">
          Insert from file
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Source picker */}
          <div className="w-[320px] border-r border-edge flex flex-col min-h-0">
            <div className="px-2 py-2 border-b border-edge flex gap-1 shrink-0">
              <input
                className="flex-1 px-2 py-1 rounded bg-sunken border border-edge text-[12px] text-text"
                placeholder="Filter layouts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="px-2 py-1 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge" onClick={browse}>
                Browse…
              </button>
            </div>
            <div className="flex-1 overflow-auto p-1">
              {layouts.length === 0 ? (
                <div className="text-[12px] text-textMuted px-2 py-4">
                  No pack layouts. Use Browse to pick a file from disk.
                </div>
              ) : (
                matches.map((p) => (
                  <button
                    key={p}
                    className={`w-full text-left px-2 py-0.5 text-[12px] rounded truncate ${
                      p === sourcePath ? "bg-accent/20 text-accent" : "text-text hover:bg-panelHeader"
                    }`}
                    title={p}
                    onClick={() => void loadSource(p, true)}
                  >
                    {p}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Component tree of the chosen source */}
          <div className="flex-1 overflow-auto p-1 min-h-0">
            {loading ? (
              <div className="text-[12px] text-textMuted px-2 py-4">Loading…</div>
            ) : error ? (
              <div className="text-[12px] text-red-400 px-2 py-4">{error}</div>
            ) : !sourceDoc ? (
              <div className="text-[12px] text-textMuted px-2 py-4">
                Choose a source layout on the left to pick a component to insert.
              </div>
            ) : root ? (
              <ForeignNode node={root} depth={0} picked={picked} onPick={setPicked} />
            ) : (
              <div className="text-[12px] text-textMuted px-2 py-4">This file has no hierarchy.</div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-edge flex items-center gap-2">
          <div className="text-[11px] text-textMuted mr-auto truncate">
            {activeDoc ? <>Insert under: <span className="text-text">{targetName}</span></> : "No active document"}
          </div>
          <button className={`${btn} text-textMuted hover:bg-button`} onClick={close}>
            Cancel
          </button>
          <button
            className={`${btn} bg-accent/25 text-accent ring-1 ring-accent/50 disabled:opacity-40`}
            disabled={!sourceDoc || !picked || !activeDoc}
            onClick={doInsert}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
