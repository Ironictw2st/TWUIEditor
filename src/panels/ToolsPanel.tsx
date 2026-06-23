import { useState } from "react";
import CharactersPanel from "./CharactersPanel";
import ScriptPanel from "./ScriptPanel";

type Tab = "characters" | "script";

/** Combined modal hosting the Characters and Script tools as tabs (was two separate toolbar
 *  buttons). Each child renders in `embedded` mode (no chrome of its own). */
export default function ToolsPanel({ onClose, initialTab = "characters" }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabBtn = (t: Tab, label: string) => (
    <button
      className={`px-2.5 py-0.5 rounded text-[11px] border ${
        tab === t ? "bg-accent/30 border-accent" : "bg-[#2a2d3a] border-edge hover:bg-[#343849]"
      }`}
      onClick={() => setTab(t)}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-12 -translate-x-1/2 w-[680px] h-[82vh] flex flex-col bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-1.5 border-b border-edge bg-[#23252f] shrink-0">
          {tabBtn("characters", "Characters")}
          {tabBtn("script", "Script")}
          <div className="flex-1" />
          <button className="text-gray-400 hover:text-gray-200 text-[14px]" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {tab === "characters" ? <CharactersPanel embedded onClose={onClose} /> : <ScriptPanel embedded onClose={onClose} />}
        </div>
      </div>
    </>
  );
}
