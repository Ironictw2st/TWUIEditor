import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { extractDataPack } from "../twui/lua";

type Tab = "clean" | "raw";

/**
 * Tweak the connected script's data to visualize changes — non-destructive
 * (overrides the parsed pack fed to the visualizer; never writes the .lua).
 * Clean = the data pack as editable JSON; Raw = the raw Lua text (re-parsed).
 */
export default function ScriptPanel({ onClose }: { onClose: () => void }) {
  const conn = useStore((s) => s.scriptConn);
  const override = useStore((s) => s.dataPackOverride);
  const draft = useStore((s) => s.scriptDraft);
  const setDataPackOverride = useStore((s) => s.setDataPackOverride);
  const setScriptDraft = useStore((s) => s.setScriptDraft);

  const [tab, setTab] = useState<Tab>("clean");
  const [error, setError] = useState<string | null>(null);

  // The pack currently driving the preview (override wins over the parsed text).
  const effectivePack = useMemo(
    () => override ?? (conn.text && conn.id ? extractDataPack(conn.text, conn.id) : null),
    [override, conn.text, conn.id]
  );

  const [jsonText, setJsonText] = useState(() =>
    effectivePack ? JSON.stringify(effectivePack, null, 2) : ""
  );
  const [luaText, setLuaText] = useState(() => draft ?? conn.text ?? "");

  const reseed = () => {
    setJsonText(effectivePack ? JSON.stringify(effectivePack, null, 2) : "");
    setLuaText(draft ?? conn.text ?? "");
    setError(null);
  };

  const applyClean = () => {
    try {
      const obj = JSON.parse(jsonText);
      setDataPackOverride(obj);
      setError(null);
    } catch (e) {
      setError(`JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const applyRaw = () => {
    if (!conn.id) {
      setError("No script_id — connect a script first.");
      return;
    }
    const pack = extractDataPack(luaText, conn.id);
    if (pack === null) {
      setError(`Couldn't find the data pack for "${conn.id}" in this Lua.`);
      return;
    }
    setScriptDraft(luaText);
    setDataPackOverride(pack);
    setError(null);
  };

  const reset = () => {
    setDataPackOverride(null);
    setScriptDraft(null);
    setError(null);
    // Reseed from the freshly-parsed text (no override now).
    const base = conn.text && conn.id ? extractDataPack(conn.text, conn.id) : null;
    setJsonText(base ? JSON.stringify(base, null, 2) : "");
    setLuaText(conn.text ?? "");
  };

  const tabBtn = (t: Tab, label: string) => (
    <button
      className={`px-2 py-0.5 rounded text-[11px] border ${
        tab === t ? "bg-accent/30 border-accent" : "bg-[#2a2d3a] border-edge hover:bg-[#343849]"
      }`}
      onClick={() => {
        setTab(t);
        setError(null);
      }}
    >
      {label}
    </button>
  );

  const connected = conn.status === "connected";

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-12 -translate-x-1/2 w-[680px] max-h-[82vh] flex flex-col bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-2 border-b border-edge bg-[#23252f]">
          <span className="font-semibold">Script</span>
          <span className="text-gray-500 truncate">{conn.id ?? "(no script_id)"}</span>
          {override != null && <span className="text-amber-300/80 text-[10px]">· tweaked</span>}
          <div className="flex-1" />
          {tabBtn("clean", "Clean (JSON)")}
          {tabBtn("raw", "Raw (Lua)")}
          <button className="ml-1 text-gray-400 hover:text-gray-200 text-[14px]" onClick={onClose}>
            ✕
          </button>
        </div>

        {!connected ? (
          <div className="p-3 text-gray-500">
            No script connected. Open a panel with a `script_id` (or connect one from the Inspector's
            Script section), then tweak its data here.
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-hidden p-2">
              {tab === "clean" ? (
                <textarea
                  className="w-full h-full min-h-[360px] font-mono text-[11px] leading-snug bg-[#0e0f15] border border-edge rounded px-2 py-1.5 outline-none resize-none whitespace-pre"
                  style={{ tabSize: 2 }}
                  spellCheck={false}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                />
              ) : (
                <textarea
                  className="w-full h-full min-h-[360px] font-mono text-[11px] leading-snug bg-[#0e0f15] border border-edge rounded px-2 py-1.5 outline-none resize-none whitespace-pre"
                  style={{ tabSize: 4 }}
                  spellCheck={false}
                  value={luaText}
                  onChange={(e) => setLuaText(e.target.value)}
                />
              )}
            </div>
            {error && (
              <div className="px-3 py-1 text-[11px] text-red-400 bg-red-950/30 whitespace-pre-wrap">
                {error}
              </div>
            )}
            <div className="px-3 py-2 border-t border-edge flex items-center gap-2">
              <span className="text-[10px] text-gray-500">
                {tab === "clean"
                  ? "Edit the data pack the script publishes. Apply to preview (not saved to the .lua)."
                  : "Edit the raw Lua; Apply re-parses its data pack."}
              </span>
              <div className="flex-1" />
              <button
                className="px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px]"
                onClick={reseed}
              >
                Revert
              </button>
              <button
                className="px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px] disabled:opacity-40"
                onClick={reset}
                disabled={!override && !draft}
              >
                Reset tweaks
              </button>
              <button
                className="px-2 py-0.5 rounded bg-accent/30 hover:bg-accent/40 border border-accent text-[11px]"
                onClick={tab === "clean" ? applyClean : applyRaw}
              >
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
