import { useMemo, useState } from "react";
import { pickOpenFile } from "../ipc/dialog";
import { useStore } from "../state/store";
import { subtreeIds } from "../twui/merge/types";
import type { ChangeKind, ChangeNode } from "../twui/merge/types";

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

const KIND_BADGE: Record<ChangeKind, { text: string; cls: string }> = {
  add: { text: "add", cls: "text-green-400" },
  remove: { text: "del", cls: "text-red-400" },
  modify: { text: "chg", cls: "text-amber-400" },
  move: { text: "move", cls: "text-sky-400" },
  reorder: { text: "order", cls: "text-sky-400" },
};

type Tri = "on" | "off" | "mixed";

/** Fixed-width raw value chip; "∅" marks an absent value. */
function Val({ v }: { v?: string }) {
  return <span className="font-mono text-[11px] text-text">{v === undefined ? "∅" : v === "" ? '""' : v}</span>;
}

function TriBox({ state, onClick }: { state: Tri; onClick: () => void }) {
  const glyph = state === "on" ? "✓" : state === "mixed" ? "–" : "";
  const cls =
    state === "off"
      ? "border-edge text-transparent"
      : "border-accent bg-accent/25 text-accent";
  return (
    <button
      className={`w-3.5 h-3.5 shrink-0 rounded-sm border grid place-items-center text-[10px] leading-none ${cls}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      tabIndex={-1}
    >
      {glyph}
    </button>
  );
}

function ChangeRow({
  node,
  depth,
  accepted,
  onToggle,
}: {
  node: ChangeNode;
  depth: number;
  accepted: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const ids = useMemo(() => subtreeIds(node), [node]);
  const onCount = ids.reduce((n, id) => n + (accepted[id] ? 1 : 0), 0);
  const tri: Tri = onCount === 0 ? "off" : onCount === ids.length ? "on" : "mixed";
  const hasKids = node.children.length > 0;
  const badge = KIND_BADGE[node.kind];

  const detail =
    node.level === "attr" ? (
      <span className="ml-1">
        <Val v={node.before} /> <span className="text-textMuted">→</span> <Val v={node.after} />
      </span>
    ) : node.attrs && node.attrs.length ? (
      <span className="ml-1 text-textMuted text-[11px] truncate">
        {node.attrs.slice(0, 4).map((d) => d.key).join(", ")}
        {node.attrs.length > 4 ? " …" : ""}
      </span>
    ) : null;

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 rounded hover:bg-panelHeader"
        style={{ paddingLeft: `${depth * 14 + 2}px` }}
      >
        <TriBox state={tri} onClick={() => onToggle(node.id, tri !== "on")} />
        <button
          className="w-3 shrink-0 text-textMuted text-[10px]"
          onClick={() => setOpen((o) => !o)}
          tabIndex={-1}
        >
          {hasKids ? (open ? "▾" : "▸") : ""}
        </button>
        <span className={`w-8 shrink-0 text-[10px] uppercase ${badge.cls}`}>{badge.text}</span>
        <span className="text-[12px] text-text truncate">{node.label}</span>
        {node.coarseOnly && <span className="text-[10px] text-textMuted">(whole)</span>}
        {detail}
        {node.dependsOn.length > 0 && tri !== "off" && (
          <span className="text-[10px] text-textMuted" title="Auto-includes referenced changes">
            +deps
          </span>
        )}
      </div>
      {open && hasKids && (
        <div>
          {node.children.map((c) => (
            <ChangeRow key={c.id} node={c} depth={depth + 1} accepted={accepted} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The left source-picker (choose File B), mirroring InsertFromFileDialog. */
function SourcePicker({ onClose }: { onClose: () => void }) {
  const layouts = useStore((s) => s.packLayouts);
  const load = useStore((s) => s.loadMergeSource);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? layouts.filter((p) => p.toLowerCase().includes(q)) : layouts;
    return list.slice(0, 600);
  }, [query, layouts]);

  const browse = async () => {
    const f = await pickOpenFile({ filters: [{ name: "TWUI Layout", extensions: ["xml"] }] });
    if (f) {
      await load(f, false);
      onClose();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-edge flex gap-1 shrink-0">
        <input
          className="flex-1 px-2 py-1 rounded bg-sunken border border-edge text-[12px] text-text"
          placeholder="Filter pack layouts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="px-2 py-1 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge" onClick={browse}>
          Browse disk…
        </button>
      </div>
      <div className="flex-1 overflow-auto p-1">
        {layouts.length === 0 ? (
          <div className="text-[12px] text-textMuted px-2 py-4">
            No pack layouts loaded. Use “Browse disk…” to pick the incoming file from disk.
          </div>
        ) : (
          matches.map((p) => (
            <button
              key={p}
              className="w-full text-left px-2 py-0.5 text-[12px] rounded truncate text-text hover:bg-panelHeader"
              title={p}
              onClick={async () => {
                await load(p, true);
                onClose();
              }}
            >
              {p}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Merge Mode overlay: diff the incoming file (B) against the active document (A) and let the user
 * accept changes individually or all at once, then apply them into A (one undo step). Rendered by
 * App while `mergeOpen`; mounts fresh each time.
 */
export default function MergeDialog() {
  const close = useStore((s) => s.closeMergeDialog);
  const fileName = useStore((s) => s.fileName);
  const source = useStore((s) => s.mergeSource);
  const diff = useStore((s) => s.mergeDiff);
  const accepted = useStore((s) => s.mergeAccepted);
  const status = useStore((s) => s.mergeStatus);
  const toggle = useStore((s) => s.toggleMergeAccept);
  const setAll = useStore((s) => s.setAllMergeAccepted);
  const apply = useStore((s) => s.applyMerge);

  const [picking, setPicking] = useState(false);
  const showPicker = !source || picking;

  const acceptedCount = useMemo(() => {
    if (!diff) return 0;
    return diff.roots.filter((r) => subtreeIds(r).some((id) => accepted[id])).length;
  }, [diff, accepted]);

  const btn = "px-3 py-1.5 rounded border border-edge text-[12px]";

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="w-[900px] h-[640px] max-w-[95vw] max-h-[92vh] rounded-lg bg-panel border border-edge shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-edge flex items-center gap-3">
          <div className="text-[13px] font-medium text-text">Merge from file</div>
          <div className="text-[11px] text-textMuted truncate">
            Base <span className="text-text">{fileName ?? "(none)"}</span>
            {source && (
              <>
                {" ← Incoming "}
                <span className="text-text">{baseName(source.path)}</span>
              </>
            )}
          </div>
          <div className="ml-auto text-[11px] text-textMuted">{status}</div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {showPicker ? (
            <SourcePicker onClose={() => setPicking(false)} />
          ) : diff ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-edge flex items-center gap-2 shrink-0">
                <button className="px-2 py-1 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge" onClick={() => setAll(true)}>
                  Accept all
                </button>
                <button className="px-2 py-1 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge" onClick={() => setAll(false)}>
                  Reject all
                </button>
                <button className="px-2 py-1 rounded text-[11px] bg-button hover:bg-buttonHover border border-edge" onClick={() => setPicking(true)}>
                  Change file…
                </button>
                <div className="ml-auto text-[11px] text-textMuted">
                  {diff.roots.length} change{diff.roots.length === 1 ? "" : "s"}
                  {diff.versionA !== diff.versionB ? ` · v${diff.versionB}→v${diff.versionA}` : ""}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-1">
                {diff.roots.length === 0 ? (
                  <div className="text-[12px] text-textMuted px-2 py-4">No differences found.</div>
                ) : (
                  diff.roots.map((r) => (
                    <ChangeRow key={r.id} node={r} depth={0} accepted={accepted} onToggle={toggle} />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 grid place-items-center text-[12px] text-textMuted">Computing diff…</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-edge flex items-center gap-2">
          <div className="text-[11px] text-textMuted mr-auto">
            {diff && diff.roots.length > 0 ? `${acceptedCount} of ${diff.roots.length} selected` : ""}
          </div>
          <button className={`${btn} text-textMuted hover:bg-button`} onClick={close}>
            Cancel
          </button>
          <button
            className={`${btn} bg-accent/25 text-accent ring-1 ring-accent/50 disabled:opacity-40`}
            disabled={!diff || acceptedCount === 0}
            onClick={() => void apply()}
          >
            Apply {acceptedCount || ""} into base
          </button>
        </div>
      </div>
    </div>
  );
}
