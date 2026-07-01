import { useMemo, useState } from "react";
import { pickOpenFile, pickSaveFile } from "../ipc/dialog";
import { useStore } from "../state/store";
import { useContextMenu, MenuItem } from "../components/ContextMenu";

const BTN = "px-2 py-0.5 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge";
const INPUT = "flex-1 min-w-0 px-2 py-1 rounded bg-sunken border border-edge text-[12px] text-text";

/** A folder node in the virtual pack tree; files are leaves with `path` set. */
interface TreeNode {
  name: string;
  path?: string;
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
  onContext,
}: {
  node: TreeNode;
  depth: number;
  current: string | null;
  onOpen: (rel: string) => void;
  onContext: (e: React.MouseEvent, rel: string) => void;
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
        onContextMenu={(e) => node.path && onContext(e, node.path)}
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
          <Folder key={c.name} node={c} depth={depth + 1} current={current} onOpen={onOpen} onContext={onContext} />
        ))}
    </div>
  );
}

/** The editable Pack Editor: open or create a `.pack`, browse/create/delete its `.twui.xml` files,
 *  and edit them (Ctrl+S writes back into the pack). Distinct from the read-only Dependencies panel. */
export default function PackEditorPanel() {
  const workspacePack = useStore((s) => s.workspacePack);
  const layouts = useStore((s) => s.workspaceLayouts);
  const current = useStore((s) => s.workspacePath);
  const newPackWorkspace = useStore((s) => s.newPackWorkspace);
  const openPackWorkspace = useStore((s) => s.openPackWorkspace);
  const closePackWorkspace = useStore((s) => s.closePackWorkspace);
  const openWorkspaceFile = useStore((s) => s.openWorkspaceFile);
  const createWorkspaceFile = useStore((s) => s.createWorkspaceFile);
  const deleteWorkspaceFile = useStore((s) => s.deleteWorkspaceFile);
  const menu = useContextMenu();

  const [query, setQuery] = useState("");
  const [newPath, setNewPath] = useState("ui/");

  const tree = useMemo(() => buildTree(layouts), [layouts]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return layouts.filter((p) => p.toLowerCase().includes(q)).slice(0, 800);
  }, [query, layouts]);

  const open = (rel: string) => void openWorkspaceFile(rel);
  const context = (e: React.MouseEvent, rel: string) => {
    const items: MenuItem[] = [
      { label: "Open", onSelect: () => void openWorkspaceFile(rel) },
      { label: "", separator: true },
      {
        label: "Delete from pack",
        danger: true,
        onSelect: () => {
          if (window.confirm(`Delete "${rel}" from the pack? This rewrites the .pack on disk.`)) {
            void deleteWorkspaceFile(rel);
          }
        },
      },
    ];
    menu.open(e, items);
  };

  const pickNew = async () => {
    const f = await pickSaveFile({ filters: [{ name: "Pack", extensions: ["pack"] }], defaultFileName: "my_mod.pack" });
    if (f) void newPackWorkspace(f);
  };
  const pickOpen = async () => {
    const f = await pickOpenFile({ filters: [{ name: "Pack", extensions: ["pack"] }] });
    if (f) void openPackWorkspace(f);
  };
  const addFile = () => {
    const rel = newPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel) return;
    const full = /\.xml$/i.test(rel) ? rel : `${rel}.twui.xml`;
    void createWorkspaceFile(full);
    setNewPath("ui/");
  };

  if (!workspacePack) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-2 h-9 flex items-center gap-1 border-b border-edge shrink-0">
          <span className="text-[11px] text-textMuted mr-auto">Pack Editor</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-[12px] text-textMuted">Open or create a .pack to edit its TWUI files.</div>
          <div className="flex gap-2">
            <button className={BTN} onClick={pickNew}>
              New Pack…
            </button>
            <button className={BTN} onClick={pickOpen}>
              Open Pack…
            </button>
          </div>
        </div>
        {menu.element}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-9 flex items-center gap-1 border-b border-edge shrink-0">
        <span className="text-[11px] text-accent mr-auto truncate" title={workspacePack}>
          {workspacePack.split(/[\\/]/).pop()}
        </span>
        <button className={BTN} onClick={pickOpen} title="Open a different pack">
          Open…
        </button>
        <button className={BTN} onClick={() => void closePackWorkspace()} title="Close the pack">
          Close
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-edge shrink-0 flex gap-1">
        <input
          className={INPUT}
          placeholder="ui/.../new_layout.twui.xml"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addFile();
          }}
        />
        <button className={BTN} onClick={addFile} title="Create a blank layout at this path">
          + New
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-edge shrink-0">
        <input
          className={`w-full ${INPUT}`}
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto p-1">
        {layouts.length === 0 ? (
          <div className="text-[12px] text-textMuted px-2 py-4">Empty pack — add a layout above.</div>
        ) : matches ? (
          matches.length ? (
            matches.map((p) => (
              <button
                key={p}
                className={`w-full text-left px-2 py-0.5 text-[12px] rounded truncate ${
                  p === current ? "bg-accent/20 text-accent" : "text-text hover:bg-panelHeader"
                }`}
                title={p}
                onClick={() => open(p)}
                onContextMenu={(e) => context(e, p)}
              >
                {p}
              </button>
            ))
          ) : (
            <div className="text-[12px] text-textMuted px-2 py-4">No matches.</div>
          )
        ) : (
          sortedChildren(tree).map((c) => (
            <Folder key={c.name} node={c} depth={0} current={current} onOpen={open} onContext={context} />
          ))
        )}
      </div>
      {menu.element}
    </div>
  );
}
