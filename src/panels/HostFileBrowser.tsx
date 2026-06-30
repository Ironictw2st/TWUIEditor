// Browser-mode replacement for native OS file dialogs. Mounted once in App; it
// renders only when dialog.ts has an active host-dialog request (web client).
// It browses the HOST filesystem through host_list_dir / host_default_paths so a
// remote user can pick game folders, packs, images, and save targets on the
// machine running the editor.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  joinHostPath,
  resolveHostDialog,
  useHostDialogRequest,
  type HostDialogRequest,
} from "../ipc/dialog";
import { hostDefaultPaths, hostListDir, type HostDirListing } from "../ipc/commands";

export default function HostFileBrowser() {
  const req = useHostDialogRequest();
  if (!req) return null;
  return <Browser req={req} key={requestKey(req)} />;
}

// A fresh key per request remounts the browser with clean local state.
let reqCounter = 0;
const reqKeys = new WeakMap<HostDialogRequest, number>();
function requestKey(req: HostDialogRequest): number {
  let k = reqKeys.get(req);
  if (k === undefined) {
    k = ++reqCounter;
    reqKeys.set(req, k);
  }
  return k;
}

function Browser({ req }: { req: HostDialogRequest }) {
  const [path, setPath] = useState<string | null>(null);
  const [listing, setListing] = useState<HostDirListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fileName, setFileName] = useState(req.defaultFileName ?? "");

  const exts = useMemo(
    () => (req.filters ?? []).flatMap((f) => f.extensions.map((e) => e.toLowerCase())),
    [req.filters],
  );
  const matchesExt = useCallback(
    (name: string) => {
      if (exts.length === 0) return true;
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
      return exts.includes(ext);
    },
    [exts],
  );

  const navigate = useCallback(async (target: string | null) => {
    setLoading(true);
    setError(null);
    setSelected([]);
    try {
      const l = await hostListDir(target);
      setListing(l);
      setPath(l.path);
    } catch (e) {
      setError(`${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial location: the request's defaultPath, else the active data root.
  useEffect(() => {
    void (async () => {
      let start = req.defaultPath ?? null;
      if (!start) {
        try {
          const def = await hostDefaultPaths();
          start = def.data_root ?? def.games_dir ?? null;
        } catch {
          start = null;
        }
      }
      await navigate(start);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveHostDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dirs = listing?.entries.filter((e) => e.is_dir) ?? [];
  const files =
    req.kind === "directory" ? [] : (listing?.entries.filter((e) => !e.is_dir && matchesExt(e.name)) ?? []);

  const toggleFile = (p: string) => {
    if (req.kind === "files") {
      setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
    } else if (req.kind === "save") {
      const name = p.split(/[\\/]/).pop() ?? "";
      setFileName(name);
    } else {
      setSelected([p]);
    }
  };

  const canConfirm =
    req.kind === "directory"
      ? !!path
      : req.kind === "save"
        ? fileName.trim().length > 0 && !!path
        : selected.length > 0;

  const confirm = () => {
    if (req.kind === "directory") {
      resolveHostDialog(path);
    } else if (req.kind === "save") {
      if (!path) return;
      let name = fileName.trim();
      if (exts.length > 0 && name.lastIndexOf(".") < 0) name = `${name}.${exts[0]}`;
      resolveHostDialog(joinHostPath(path, name));
    } else if (req.kind === "files") {
      resolveHostDialog(selected.length ? selected : null);
    } else {
      resolveHostDialog(selected[0] ?? null);
    }
  };

  const title =
    req.title ??
    (req.kind === "directory"
      ? "Choose a folder"
      : req.kind === "save"
        ? "Save as"
        : req.kind === "files"
          ? "Choose files"
          : "Choose a file");

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50"
      onClick={() => resolveHostDialog(null)}
    >
      <div
        className="flex h-[560px] w-[640px] flex-col rounded-lg border border-edge bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[13px] font-medium text-text">{title}</div>

        {/* Path bar */}
        <div className="mb-2 flex items-center gap-2">
          <button
            className="rounded border border-edge px-2 py-1 text-[12px] text-textMuted hover:bg-button"
            onClick={() => navigate(listing?.parent ?? null)}
            title="Up one level"
          >
            Up
          </button>
          <button
            className="rounded border border-edge px-2 py-1 text-[12px] text-textMuted hover:bg-button"
            onClick={() => navigate(null)}
            title="Drives / roots"
          >
            Drives
          </button>
          <div className="flex-1 truncate rounded border border-edge bg-bg px-2 py-1 text-[12px] text-textMuted">
            {path ?? "This PC"}
          </div>
        </div>

        {/* Listing */}
        <div className="flex-1 overflow-auto rounded border border-edge bg-bg">
          {loading ? (
            <div className="p-3 text-[12px] text-textMuted">Loading…</div>
          ) : error ? (
            <div className="p-3 text-[12px] text-red-400">{error}</div>
          ) : (
            <ul className="text-[12px]">
              {dirs.map((d) => (
                <li
                  key={d.path}
                  className="cursor-pointer truncate px-3 py-1 text-text hover:bg-button"
                  onDoubleClick={() => navigate(d.path)}
                  onClick={() => navigate(d.path)}
                  title={d.path}
                >
                  [dir] {d.name}
                </li>
              ))}
              {files.map((f) => {
                const isSel = req.kind === "save" ? false : selected.includes(f.path);
                return (
                  <li
                    key={f.path}
                    className={`cursor-pointer truncate px-3 py-1 hover:bg-button ${
                      isSel ? "bg-accent/25 text-accent" : "text-textMuted"
                    }`}
                    onClick={() => toggleFile(f.path)}
                    onDoubleClick={() => {
                      toggleFile(f.path);
                      if (req.kind === "file") resolveHostDialog(f.path);
                    }}
                    title={f.path}
                  >
                    {f.name}
                  </li>
                );
              })}
              {dirs.length === 0 && files.length === 0 && (
                <li className="px-3 py-2 text-textMuted">Nothing to show here.</li>
              )}
            </ul>
          )}
        </div>

        {/* Save filename input */}
        {req.kind === "save" && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[12px] text-textMuted">File name</span>
            <input
              className="flex-1 rounded border border-edge bg-bg px-2 py-1 text-[12px] text-text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder={exts.length ? `name.${exts[0]}` : "name"}
            />
          </div>
        )}

        {/* Actions */}
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded border border-edge px-3 py-1.5 text-[12px] text-textMuted hover:bg-button"
            onClick={() => resolveHostDialog(null)}
          >
            Cancel
          </button>
          <button
            className="rounded border border-edge bg-accent/25 px-3 py-1.5 text-[12px] text-accent ring-1 ring-accent/50 disabled:opacity-40"
            onClick={confirm}
            disabled={!canConfirm}
          >
            {req.kind === "directory" ? "Select folder" : req.kind === "save" ? "Save" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
