import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";

/** A folder node in the virtual pack tree; files are leaves with `path` set. */
interface TreeNode {
  name: string;
  path?: string; // full source-relative path on file leaves
  children: Map<string, TreeNode>;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };
  for (const p of paths) {
    const segs = p.split("/");
    let node = root;
    segs.forEach((seg, i) => {
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, children: new Map() };
        node.children.set(seg, child);
      }
      if (i === segs.length - 1) child.path = p;
      node = child;
    });
  }
  return root;
}

/** Folders first, then files; each alphabetical. */
function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const af = a.children.size > 0 ? 0 : 1;
    const bf = b.children.size > 0 ? 0 : 1;
    return af !== bf ? af - bf : a.name.localeCompare(b.name);
  });
}

function Folder({
  node,
  depth,
  current,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  current: string | null;
  onOpen: (rel: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.children.size > 0;
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (!isFolder) {
    const active = current != null && node.path != null && node.path === current;
    return (
      <button
        className={`w-full text-left px-1 py-0.5 text-[12px] rounded truncate ${
          active ? "bg-accent/20 text-accent" : "text-text hover:bg-panelHeader"
        }`}
        style={pad}
        title={node.path}
        onClick={() => node.path && onOpen(node.path)}
      >
        {node.name}
      </button>
    );
  }
  return (
    <div>
      <button
        className="w-full text-left px-1 py-0.5 text-[12px] text-textMuted hover:bg-panelHeader rounded truncate"
        style={pad}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="inline-block w-3">{open ? "▾" : "▸"}</span>
        {node.name}/
      </button>
      {open &&
        sortedChildren(node).map((c) => (
          <Folder key={c.name} node={c} depth={depth + 1} current={current} onOpen={onOpen} />
        ))}
    </div>
  );
}

/** Persistent dock panel for browsing the active source's `.twui.xml` layouts.
 *  Clicking a layout opens it without closing the panel (fast switching). An
 *  overlay control layers a single chosen `.pack` over the base source. */
export default function PackFilesPanel() {
  const layouts = useStore((s) => s.packLayouts);
  const packPath = useStore((s) => s.packPath);
  const overlayPack = useStore((s) => s.overlayPack);
  const openFile = useStore((s) => s.openFile);
  const setOverlayPack = useStore((s) => s.setOverlayPack);
  const clearOverlayPack = useStore((s) => s.clearOverlayPack);

  const [query, setQuery] = useState("");

  const tree = useMemo(() => buildTree(layouts), [layouts]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return layouts.filter((p) => p.toLowerCase().includes(q)).slice(0, 800);
  }, [query, layouts]);

  const openLayout = (rel: string) => void openFile(rel, true);

  const pickOverlay = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "Pack", extensions: ["pack"] }] });
    if (typeof f === "string") void setOverlayPack(f);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-9 flex items-center gap-1 border-b border-edge shrink-0">
        <span className="text-[11px] text-textMuted mr-auto">{layouts.length} layouts</span>
        {overlayPack ? (
          <button
            className="px-2 py-0.5 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge"
            title={`Overlay: ${overlayPack}`}
            onClick={() => void clearOverlayPack()}
          >
            Clear overlay
          </button>
        ) : (
          <button
            className="px-2 py-0.5 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge"
            title="Layer a single .pack over the base source"
            onClick={pickOverlay}
          >
            Overlay a pack…
          </button>
        )}
      </div>
      {overlayPack && (
        <div className="px-2 py-1 text-[10px] text-accent border-b border-edge truncate" title={overlayPack}>
          overlay: {overlayPack.split(/[\\/]/).pop()}
        </div>
      )}
      <div className="px-2 py-1.5 border-b border-edge shrink-0">
        <input
          className="w-full px-2 py-1 rounded bg-sunken border border-edge text-[12px] text-text"
          placeholder="Filter layouts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto p-1">
        {layouts.length === 0 ? (
          <div className="text-[12px] text-textMuted px-2 py-4">
            No layouts. Enter pack mode (Settings → Pack folder) or open a folder.
          </div>
        ) : matches ? (
          matches.length ? (
            matches.map((p) => (
              <button
                key={p}
                className={`w-full text-left px-2 py-0.5 text-[12px] rounded truncate ${
                  p === packPath ? "bg-accent/20 text-accent" : "text-text hover:bg-panelHeader"
                }`}
                title={p}
                onClick={() => openLayout(p)}
              >
                {p}
              </button>
            ))
          ) : (
            <div className="text-[12px] text-textMuted px-2 py-4">No matches.</div>
          )
        ) : (
          sortedChildren(tree).map((c) => (
            <Folder key={c.name} node={c} depth={0} current={packPath} onOpen={openLayout} />
          ))
        )}
      </div>
    </div>
  );
}
