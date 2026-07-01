import { useEffect, useState, type ReactNode } from "react";
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
import CharactersPanel from "./panels/CharactersPanel";
import ScriptPanel from "./panels/ScriptPanel";
import SettingsPanel from "./panels/SettingsPanel";
import PackFilesPanel from "./panels/PackFilesPanel";
import PackEditorPanel from "./panels/PackEditorPanel";
import LayersPanel from "./panels/LayersPanel";
import DiagnosisPanel from "./panels/DiagnosisPanel";
import { cheapErrorCount } from "./twui/diagnostics";
import LoadingScreen from "./panels/LoadingScreen";
import UnsavedChangesDialog from "./panels/UnsavedChangesDialog";
import SearchPalette from "./panels/SearchPalette";
import BugReportPanel from "./panels/BugReportPanel";
import UpdateBanner from "./panels/UpdateBanner";
import DocsPanel from "./panels/DocsPanel";
import NewFileDialog from "./panels/NewFileDialog";
import InsertFromFileDialog from "./panels/InsertFromFileDialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pickOpenFile } from "./ipc/dialog";
import { captureAppWindow } from "./ipc/commands";
import { IS_BROWSER } from "./ipc/invoke";
import HostFileBrowser from "./panels/HostFileBrowser";

const PANEL_TITLES: Record<PanelId, string> = {
  hierarchy: "Hierarchy",
  inspector: "Inspector",
  visualizer: "Visualizer",
  perspective: "Perspective",
  packfiles: "Dependencies",
  packeditor: "Pack Editor",
  layers: "Layers",
  diagnosis: "Diagnosis",
};

/** App mark (rider on horseback raising a scroll) shown top-left in place of a text title. */
function Logo() {
  return <img src={logoUrl} width={26} height={26} className="mr-1 shrink-0 rounded" alt="TWUI Editor" />;
}

function Toolbar() {
  const init = useStore((s) => s.init);
  const dirty = useStore((s) => s.dirty);
  const status = useStore((s) => s.status);

  useEffect(() => {
    // Keep the loading screen up until the whole boot chain (incl. restoring the
    // last game in its saved read mode) has resolved.
    init().finally(() => useStore.setState({ loading: false }));
  }, [init]);

  const [showCharacters, setShowCharacters] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
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

  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-edge bg-panel shrink-0">
      <Logo />
      <PackMenu />
      <GameMenu
        onCharacters={() => setShowCharacters(true)}
        onScript={() => setShowScript(true)}
      />
      <SettingsMenu
        onSettings={() => setShowSettings(true)}
        onDocs={() => setShowDocs(true)}
        onBugReport={openBugReport}
      />
      <PanelsMenu />
      <DiagnosisBadge />
      {showCharacters && <CharactersPanel onClose={() => setShowCharacters(false)} />}
      {showScript && <ScriptPanel onClose={() => setShowScript(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showDocs && <DocsPanel onClose={() => setShowDocs(false)} />}
      {showBugReport && (
        <BugReportPanel onClose={() => setShowBugReport(false)} initialProgramShot={bugProgramShot} />
      )}
      <div className="flex-1" />
      <span className="text-[12px] text-gray-500 max-w-[420px] truncate">
        {status}
        {dirty ? " *" : ""}
      </span>
      <span className="text-[10px] text-textMuted self-center tabular-nums" title="Version">
        v{__APP_VERSION__}
      </span>
    </div>
  );
}

/** Debounced count of cheap-rule integrity errors in the open document. Cheap-only
 *  so it can refresh on every edit without re-running the expensive sweep. */
function useCheapErrorCount(): number {
  const doc = useStore((s) => s.doc);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setCount(cheapErrorCount(doc)), 200);
    return () => clearTimeout(t);
  }, [doc]);
  return count;
}

/** Live error badge in the toolbar; hidden when the file is clean. Clicking it
 *  reveals the Diagnosis panel. Counts errors only (warnings stay advisory). */
function DiagnosisBadge() {
  const n = useCheapErrorCount();
  if (n === 0) return null;
  return (
    <button
      className="px-2 py-0.5 rounded text-[11px] bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
      title={`${n} integrity error${n === 1 ? "" : "s"} — click to open Diagnosis`}
      onClick={() => dockShowPanel("diagnosis")}
    >
      {n} error{n === 1 ? "" : "s"}
    </button>
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

/** Shared shell for the toolbar's click-to-open dropdown menus (Pack / Game / Settings).
 *  The `children` render-prop receives a `close` callback so each item can dismiss the menu. */
function ToolbarMenu({
  label,
  title,
  width = "w-52",
  children,
}: {
  label: string;
  title?: string;
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = "px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[12px]";
  return (
    <div className="relative">
      <button className={btn} onClick={() => setOpen((o) => !o)} title={title}>
        {label} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-40 mt-1 left-0 ${width} rounded-md bg-sunken border border-edge shadow-xl p-1`}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

const menuItem =
  "w-full text-left px-2 py-1 rounded text-[11px] text-text hover:bg-panelHeader disabled:opacity-40";

/** Pack menu: create, open and save the active layout/pack file. */
function PackMenu() {
  const openFileDialog = useStore((s) => s.openFileDialog);
  const save = useStore((s) => s.save);
  const saveAsDialog = useStore((s) => s.saveAsDialog);
  const fileName = useStore((s) => s.fileName);
  const openNewFileDialog = useStore((s) => s.openNewFileDialog);
  const openInsertDialog = useStore((s) => s.openInsertDialog);
  const newFromFile = useStore((s) => s.newFromFile);
  const hasDoc = useStore((s) => s.doc != null);

  const newFromDisk = async () => {
    const path = await pickOpenFile({ filters: [{ name: "TWUI Layout", extensions: ["xml"] }] });
    if (path) await newFromFile(path, false);
  };

  return (
    <ToolbarMenu label="Pack" title="Create, open & save files">
      {(close) => {
        const pick = (fn: () => void) => {
          close();
          fn();
        };
        return (
          <>
            <button className={menuItem} onClick={() => pick(() => openNewFileDialog())}>
              New blank file…
            </button>
            <button className={menuItem} onClick={() => pick(() => void newFromDisk())}>
              New from file…
            </button>
            <button
              className={menuItem}
              disabled={!hasDoc}
              title={hasDoc ? undefined : "Open or create a layout first"}
              onClick={() => pick(() => openInsertDialog())}
            >
              Insert from file…
            </button>
            <div className="my-1 h-px bg-edge" />
            <button className={menuItem} onClick={() => pick(() => openFileDialog())}>
              Open…
            </button>
            <div className="my-1 h-px bg-edge" />
            <button className={menuItem} disabled={!fileName} onClick={() => pick(() => save())}>
              Save
            </button>
            <button className={menuItem} disabled={!fileName} onClick={() => pick(() => saveAsDialog())}>
              Save As…
            </button>
          </>
        );
      }}
    </ToolbarMenu>
  );
}

/** Game menu: pick the active game and open the characters / script tools. */
function GameMenu({ onCharacters, onScript }: { onCharacters: () => void; onScript: () => void }) {
  const games = useStore((s) => s.games);
  const game = useStore((s) => s.game);
  const setGame = useStore((s) => s.setGame);

  return (
    <ToolbarMenu label="Game" title="Active game, characters & script">
      {(close) => (
        <>
          {games.length > 0 && (
            <>
              <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-textMuted">
                Active Game
              </div>
              {games.map((g) => (
                <button
                  key={g}
                  className="w-full flex items-center gap-2 text-left px-2 py-1 rounded text-[11px] text-text hover:bg-panelHeader"
                  onClick={() => {
                    close();
                    setGame(g);
                  }}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${g === game ? "bg-accent" : "border border-gray-600"}`}
                  />
                  <span className="mr-auto">{g}</span>
                </button>
              ))}
              <div className="my-1 h-px bg-edge" />
            </>
          )}
          <button
            className={menuItem}
            title="Assign characters to portrait roles"
            onClick={() => {
              close();
              onCharacters();
            }}
          >
            Characters
          </button>
          <button
            className={menuItem}
            title="Tweak the connected script's data"
            onClick={() => {
              close();
              onScript();
            }}
          >
            Script
          </button>
        </>
      )}
    </ToolbarMenu>
  );
}

/** Settings menu: preferences, reference docs and the bug reporter. */
function SettingsMenu({
  onSettings,
  onDocs,
  onBugReport,
}: {
  onSettings: () => void;
  onDocs: () => void;
  onBugReport: () => void;
}) {
  return (
    <ToolbarMenu label="Settings" title="Settings, docs & bug report" width="w-44">
      {(close) => (
        <>
          <button
            className={menuItem}
            onClick={() => {
              close();
              onSettings();
            }}
          >
            Settings
          </button>
          <button
            className={menuItem}
            onClick={() => {
              close();
              onDocs();
            }}
          >
            Docs
          </button>
          {/* Bug reporting captures the host window and posts to a webhook — desktop only. */}
          {!IS_BROWSER && (
            <>
              <div className="my-1 h-px bg-edge" />
              <button
                className={menuItem}
                onClick={() => {
                  close();
                  onBugReport();
                }}
              >
                Report a Bug
              </button>
            </>
          )}
        </>
      )}
    </ToolbarMenu>
  );
}

/** A single panel rendered to fill a popped-out OS window (no toolbar / other panels). */
function PanelWindow({ panel }: { panel: PanelId }) {
  if (panel === "hierarchy") return <div className="h-full flex flex-col bg-panel">{<TreePanel />}</div>;
  if (panel === "inspector") return <div className="h-full flex flex-col bg-panel">{<InspectorPanel />}</div>;
  if (panel === "perspective") return <div className="h-full overflow-auto bg-panel">{<PerspectivePanel />}</div>;
  if (panel === "packfiles") return <div className="h-full flex flex-col bg-panel">{<PackFilesPanel />}</div>;
  if (panel === "packeditor") return <div className="h-full flex flex-col bg-panel">{<PackEditorPanel />}</div>;
  if (panel === "layers") return <div className="h-full overflow-auto bg-panel">{<LayersPanel />}</div>;
  if (panel === "diagnosis") return <div className="h-full flex flex-col bg-panel">{<DiagnosisPanel />}</div>;
  return <div className="h-full bg-canvas">{<VisualizerPanel />}</div>;
}

export default function App() {
  const searchOpen = useStore((s) => s.searchOpen);
  const closeSearch = useStore((s) => s.closeSearch);
  const newFileOpen = useStore((s) => s.newFileOpen);
  const insertOpen = useStore((s) => s.insertOpen);
  const loading = useStore((s) => s.loading);

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

  // Intercept window close (main window only): if there are unsaved edits, hold the
  // close and raise the unsaved-changes prompt instead of losing them. In the web
  // client there is no Tauri window — fall back to a native beforeunload guard.
  useEffect(() => {
    if (panelParam()) return; // popped-out panel windows close freely
    if (IS_BROWSER) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (useStore.getState().tabs.some((t) => t.dirty)) {
          e.preventDefault();
          e.returnValue = "";
        }
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        const s = useStore.getState();
        if (s.tabs.some((t) => t.dirty)) {
          // Hold the close on every attempt while any open file is dirty; raise the prompt once.
          event.preventDefault();
          if (!s.pendingClose) useStore.setState({ pendingClose: true });
        }
      })
      .then((un) => {
        unlisten = un;
      });
    return () => unlisten?.();
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
      {newFileOpen && <NewFileDialog />}
      {insertOpen && <InsertFromFileDialog />}
      {import.meta.env.PROD && !IS_BROWSER && <UpdateBanner />}
      <UnsavedChangesDialog />
      <HostFileBrowser />
      {loading && <LoadingScreen />}
    </div>
  );
}
