import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import type { PanelId } from "./state/store";
import { PANEL_IDS } from "./state/store";
import { runMatchingAction } from "./keybinds";
import logoUrl from "./assets/logo.svg";
import { panelParam } from "./sync";
import { closePanelWindow } from "./windows";
import TreePanel from "./panels/TreePanel";
import InspectorPanel from "./panels/InspectorPanel";
import VisualizerPanel from "./panels/VisualizerPanel";
import PerspectivePanel from "./panels/PerspectivePanel";
import DockLayout, { dockShowPanel, dockHidePanel } from "./panels/DockLayout";
import ToolsPanel from "./panels/ToolsPanel";
import SettingsPanel from "./panels/SettingsPanel";
import SearchPalette from "./panels/SearchPalette";
import BugReportPanel from "./panels/BugReportPanel";
import UpdateBanner from "./panels/UpdateBanner";
import { captureAppWindow } from "./ipc/commands";

const PANEL_TITLES: Record<PanelId, string> = {
  hierarchy: "Hierarchy",
  inspector: "Inspector",
  visualizer: "Visualizer",
  perspective: "Perspective",
};

/** App mark (rider on horseback raising a scroll) shown top-left in place of a text title. */
function Logo() {
  return <img src={logoUrl} width={26} height={26} className="mr-1 shrink-0 rounded" alt="TWUI Editor" />;
}

function Toolbar() {
  const {
    init,
    openFileDialog,
    save: saveFile,
    saveAsDialog,
    games,
    game,
    setGame,
    fileName,
    dirty,
    status,
  } = useStore();

  useEffect(() => {
    init();
  }, [init]);

  const [showTools, setShowTools] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [bugProgramShot, setBugProgramShot] = useState<string | null>(null);

  // Capture the app window before the modal renders (best-effort) so the shot is clean.
  const openBugReport = async () => {
    let shot: string | null = null;
    try {
      shot = await captureAppWindow();
    } catch {
      shot = null;
    }
    setBugProgramShot(shot);
    setShowBugReport(true);
  };

  const btn =
    "px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[12px] disabled:opacity-40";

  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-edge bg-panel shrink-0">
      <Logo />
      <span className="text-[10px] text-textMuted mr-1 self-center tabular-nums" title="Version">
        v{__APP_VERSION__}
      </span>
      <button className={btn} onClick={() => openFileDialog()}>
        Open…
      </button>
      <button className={btn} onClick={() => saveFile()} disabled={!fileName}>
        Save
      </button>
      <button className={btn} onClick={() => saveAsDialog()} disabled={!fileName}>
        Save As…
      </button>
      <div className="w-px h-5 bg-edge mx-1" />
      {games.length > 0 && (
        <select
          className="px-2 py-1 rounded bg-button border border-edge text-[12px]"
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
        onClick={() => setShowTools(true)}
        title="Assign characters & tweak the connected script"
      >
        Characters / Script
      </button>
      <button className={btn} onClick={() => setShowSettings(true)} title="Game, keybinds & preferences">
        Settings
      </button>
      <button className={btn} onClick={openBugReport} title="Report a bug to the author">
        Report a Bug
      </button>
      <PanelsMenu />
      {showTools && <ToolsPanel onClose={() => setShowTools(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showBugReport && (
        <BugReportPanel onClose={() => setShowBugReport(false)} initialProgramShot={bugProgramShot} />
      )}
      <div className="flex-1" />
      <span className="text-[12px] text-gray-500 max-w-[420px] truncate">
        {status}
        {dirty ? " *" : ""}
      </span>
    </div>
  );
}

/** Toolbar dropdown to show/hide (or redock) each panel in the dock. */
function PanelsMenu() {
  const [open, setOpen] = useState(false);
  const docked = useStore((s) => s.dockedPanels);
  const popped = useStore((s) => s.poppedPanels);
  const btn = "px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[12px]";

  const toggle = (id: PanelId) => {
    if (popped[id]) {
      // bring the popped-out window back into the dock
      useStore.getState().setPanelPopped(id, false);
      closePanelWindow(id);
      dockShowPanel(id);
    } else if (docked.includes(id)) {
      dockHidePanel(id);
    } else {
      dockShowPanel(id);
    }
  };

  return (
    <div className="relative">
      <button className={btn} onClick={() => setOpen((o) => !o)} title="Show / hide panels">
        Panels ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 left-0 w-44 rounded-md bg-sunken border border-edge shadow-xl p-1">
            {PANEL_IDS.map((id) => {
              const state = popped[id] ? "window" : docked.includes(id) ? "shown" : "hidden";
              return (
                <button
                  key={id}
                  className="w-full flex items-center gap-2 text-left px-2 py-1 rounded text-[11px] text-text hover:bg-panelHeader"
                  onClick={() => toggle(id)}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${state === "shown" ? "bg-accent" : "border border-gray-600"}`} />
                  <span className="mr-auto">{PANEL_TITLES[id]}</span>
                  {state === "window" && <span className="text-[10px] text-gray-500">window</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** A single panel rendered to fill a popped-out OS window (no toolbar / other panels). */
function PanelWindow({ panel }: { panel: PanelId }) {
  if (panel === "hierarchy") return <div className="h-full flex flex-col bg-panel">{<TreePanel />}</div>;
  if (panel === "inspector") return <div className="h-full flex flex-col bg-panel">{<InspectorPanel />}</div>;
  if (panel === "perspective") return <div className="h-full overflow-auto bg-panel">{<PerspectivePanel />}</div>;
  return <div className="h-full bg-canvas">{<VisualizerPanel />}</div>;
}

export default function App() {
  const searchOpen = useStore((s) => s.searchOpen);
  const closeSearch = useStore((s) => s.closeSearch);

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

  // A popped-out panel window renders only that panel; its store is mirrored from the main window.
  const panel = panelParam();
  if (panel && (PANEL_IDS as string[]).includes(panel)) {
    return <PanelWindow panel={panel as PanelId} />;
  }

  return (
    <div className="h-full flex flex-col">
      <Toolbar />
      <div className="flex-1 flex min-h-0">
        <DockLayout />
      </div>
      {searchOpen && <SearchPalette onClose={closeSearch} />}
      {import.meta.env.PROD && <UpdateBanner />}
    </div>
  );
}
