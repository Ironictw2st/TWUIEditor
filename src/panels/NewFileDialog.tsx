import { useEffect, useState } from "react";
import { useStore } from "../state/store";

/** Meaningful layout versions (newest first) with the game each targets. */
const VERSIONS = [
  { v: "146", label: "146 — Warhammer 3+" },
  { v: "136", label: "136 — Three Kingdoms+" },
  { v: "135", label: "135 — Three Kingdoms (old)" },
];

/** Best-guess version for the active game (folder name under games/). */
function defaultVersionFor(game: string | null): string {
  const g = (game ?? "").toLowerCase();
  if (g.includes("wh") || g.includes("warhammer")) return "146";
  if (g.includes("3k") || g.includes("three")) return "136";
  return "146";
}

/** Modal for creating a blank layout. Rendered by App only while `newFileOpen` is set. */
export default function NewFileDialog() {
  const close = useStore((s) => s.closeNewFileDialog);
  const newBlankFile = useStore((s) => s.newBlankFile);
  const game = useStore((s) => s.game);
  const [name, setName] = useState("untitled");
  const [version, setVersion] = useState(() => defaultVersionFor(game));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const create = () => void newBlankFile({ version, name });

  const btn = "px-3 py-1.5 rounded border border-edge text-[12px]";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="w-[420px] rounded-lg bg-panel border border-edge shadow-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] font-medium text-text mb-3">New TWUI file</div>

        <label className="block text-[11px] text-textMuted mb-1">Name</label>
        <input
          className="w-full px-2 py-1 rounded bg-sunken border border-edge text-[12px] text-text mb-3"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />

        <label className="block text-[11px] text-textMuted mb-1">Layout version</label>
        <select
          className="w-full px-2 py-1 rounded bg-button border border-edge text-[12px] mb-1"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        >
          {VERSIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="text-[10px] text-textMuted mb-4">
          Creates an empty root sized to the render resolution. Saved to disk via Save As.
        </div>

        <div className="flex justify-end gap-2">
          <button className={`${btn} text-textMuted hover:bg-button`} onClick={close}>
            Cancel
          </button>
          <button className={`${btn} bg-accent/25 text-accent ring-1 ring-accent/50`} onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
