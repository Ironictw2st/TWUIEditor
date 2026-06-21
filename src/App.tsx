import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStore } from "./state/store";
import { runMatchingAction } from "./keybinds";
import TreePanel from "./panels/TreePanel";
import InspectorPanel from "./panels/InspectorPanel";
import VisualizerPanel from "./panels/VisualizerPanel";
import CharactersPanel from "./panels/CharactersPanel";
import ScriptPanel from "./panels/ScriptPanel";
import SettingsPanel from "./panels/SettingsPanel";

function Toolbar() {
  const {
    init,
    openFile,
    save: saveFile,
    saveAs,
    dataRoot,
    games,
    game,
    setGame,
    fileName,
    dirty,
    status,
    undo,
    redo,
    undoStack,
    redoStack,
  } = useStore();

  useEffect(() => {
    init();
  }, [init]);

  const onOpen = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "TWUI Layout", extensions: ["xml"] }],
      defaultPath: dataRoot ?? undefined,
    });
    if (typeof path === "string") openFile(path);
  };

  const onSaveAs = async () => {
    const path = await save({
      filters: [{ name: "TWUI Layout", extensions: ["xml"] }],
      defaultPath: dataRoot ?? undefined,
    });
    if (path) saveAs(path);
  };

  const [showCharacters, setShowCharacters] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const scriptConnected = useStore((s) => s.scriptConn.status === "connected");

  const btn =
    "px-2.5 py-1 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[12px] disabled:opacity-40";

  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-edge bg-panel shrink-0">
      <span className="font-semibold text-accent mr-2">TWUI Editor</span>
      <button className={btn} onClick={onOpen}>
        Open…
      </button>
      <button className={btn} onClick={() => saveFile()} disabled={!fileName}>
        Save
      </button>
      <button className={btn} onClick={onSaveAs} disabled={!fileName}>
        Save As…
      </button>
      <div className="w-px h-5 bg-edge mx-1" />
      <button className={btn} onClick={undo} disabled={undoStack.length === 0}>
        Undo
      </button>
      <button className={btn} onClick={redo} disabled={redoStack.length === 0}>
        Redo
      </button>
      <div className="w-px h-5 bg-edge mx-1" />
      {games.length > 0 && (
        <select
          className="px-2 py-1 rounded bg-[#2a2d3a] border border-edge text-[12px]"
          value={game ?? ""}
          onChange={(e) => setGame(e.target.value)}
          title="Active game (games/ folder)"
        >
          {!game && <option value="">Game…</option>}
          {games.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}
      <button
        className={btn}
        onClick={() => setShowCharacters(true)}
        title="Assign characters to this screen's roles"
      >
        Characters
      </button>
      <button
        className={btn}
        onClick={() => setShowScript(true)}
        disabled={!scriptConnected}
        title="Tweak the connected script's data to visualize changes"
      >
        Script
      </button>
      <button className={btn} onClick={() => setShowSettings(true)} title="Game, keybinds & preferences">
        Settings
      </button>
      {showCharacters && <CharactersPanel onClose={() => setShowCharacters(false)} />}
      {showScript && <ScriptPanel onClose={() => setShowScript(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <div className="flex-1" />
      <span className="text-[12px] text-gray-500 max-w-[420px] truncate">
        {status}
        {dirty ? " *" : ""}
      </span>
    </div>
  );
}

export default function App() {
  // Global shortcuts run through the central keybinding registry (src/keybinds.ts),
  // resolving each action's binding from the user's persisted overrides. Reading the
  // store via getState() inside the handler keeps it current without re-registering.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const s = useStore.getState();
      runMatchingAction(e, s.settings.keybinds, s, editing);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <Toolbar />
      <div className="flex-1 flex min-h-0">
        <div className="w-[330px] shrink-0 border-r border-edge bg-panel overflow-hidden flex flex-col">
          <TreePanel />
        </div>
        <div className="flex-1 min-w-0 bg-[#101118]">
          <VisualizerPanel />
        </div>
        <div className="w-[370px] shrink-0 border-l border-edge bg-panel overflow-hidden flex flex-col">
          <InspectorPanel />
        </div>
      </div>
    </div>
  );
}
