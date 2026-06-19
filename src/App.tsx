import { useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStore } from "./state/store";
import TreePanel from "./panels/TreePanel";
import InspectorPanel from "./panels/InspectorPanel";
import VisualizerPanel from "./panels/VisualizerPanel";

function Toolbar() {
  const {
    init,
    openFile,
    save: saveFile,
    saveAs,
    setDataRoot,
    dataRoot,
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

  const onPickRoot = async () => {
    const dir = await open({ directory: true, defaultPath: dataRoot ?? undefined });
    if (typeof dir === "string") setDataRoot(dir);
  };

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
        ↶ Undo
      </button>
      <button className={btn} onClick={redo} disabled={redoStack.length === 0}>
        ↷ Redo
      </button>
      <div className="w-px h-5 bg-edge mx-1" />
      <button className={btn} onClick={onPickRoot} title={dataRoot ?? "not set"}>
        3K Root: {dataRoot ? "set" : "none"}
      </button>
      <div className="flex-1" />
      <span className="text-[12px] text-gray-300">
        {fileName ? `${fileName}${dirty ? " *" : ""}` : "No file"}
      </span>
      <span className="text-[12px] text-gray-500 ml-3 max-w-[360px] truncate">{status}</span>
    </div>
  );
}

export default function App() {
  const { undo, redo, save: saveFile, deleteSelected, selectedGuid } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveFile();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !editing && selectedGuid) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, saveFile, deleteSelected, selectedGuid]);

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
