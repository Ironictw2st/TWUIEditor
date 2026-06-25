import { DockviewReact, themeAbyss } from "dockview-react";
import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanelProps,
  IDockviewPanelHeaderProps,
} from "dockview-react";
import "dockview-core/dist/styles/dockview.css";
import { useStore } from "../state/store";
import type { PanelId } from "../state/store";
import { PANEL_IDS } from "../state/store";
import { popOutPanel } from "../windows";
import TreePanel from "./TreePanel";
import InspectorPanel from "./InspectorPanel";
import VisualizerPanel from "./VisualizerPanel";
import PerspectivePanel from "./PerspectivePanel";
import PackFilesPanel from "./PackFilesPanel";

const TITLES: Record<PanelId, string> = {
  hierarchy: "Hierarchy",
  inspector: "Inspector",
  visualizer: "Visualizer",
  perspective: "Perspective",
  packfiles: "Pack Files",
};

// --- panel content (the dockview panel body) -----------------------------------------------------
const HierarchyView = (_p: IDockviewPanelProps) => <div className="h-full flex flex-col bg-panel"><TreePanel /></div>;
const InspectorView = (_p: IDockviewPanelProps) => <div className="h-full flex flex-col bg-panel"><InspectorPanel /></div>;
const VisualizerView = (_p: IDockviewPanelProps) => <div className="h-full bg-canvas"><VisualizerPanel /></div>;
const PerspectiveView = (_p: IDockviewPanelProps) => <div className="h-full overflow-auto bg-panel"><PerspectivePanel /></div>;
const PackFilesView = (_p: IDockviewPanelProps) => <div className="h-full flex flex-col bg-panel"><PackFilesPanel /></div>;

const components = {
  hierarchy: HierarchyView,
  inspector: InspectorView,
  visualizer: VisualizerView,
  perspective: PerspectiveView,
  packfiles: PackFilesView,
};

// --- pop-out tab ---------------------------------------------------------------------------------
function PopOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

/** A panel tab with a pop-out-to-window button (alongside dockview's own close affordance). */
function PanelTab(props: IDockviewPanelHeaderProps) {
  const id = props.api.id as PanelId;
  const pop = (e: React.MouseEvent) => {
    e.stopPropagation();
    useStore.getState().setPanelPopped(id, true);
    props.api.close(); // leave the dock
    popOutPanel(id, (pid) => {
      useStore.getState().setPanelPopped(pid, false);
      addPanelToDock(props.containerApi, pid); // redock when the window closes
    });
  };
  return (
    <div className="flex items-center gap-2 px-2 h-full text-[12px]">
      <span className="truncate">{props.api.title ?? TITLES[id]}</span>
      <button
        className="text-textMuted hover:text-accent"
        title="Pop out into its own window"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={pop}
      >
        <PopOutIcon />
      </button>
    </div>
  );
}

// --- dock api (module singleton so the toolbar Panels menu can show/hide panels) ------------------
let DOCK_API: DockviewApi | null = null;

function addPanelToDock(api: DockviewApi, id: PanelId, position?: Parameters<DockviewApi["addPanel"]>[0]["position"]) {
  if (api.getPanel(id)) return;
  api.addPanel({ id, component: id, tabComponent: "panelTab", title: TITLES[id], position });
}

/** Show a panel that's been hidden/closed (used by the toolbar Panels menu). */
export function dockShowPanel(id: PanelId) {
  if (!DOCK_API) return;
  if (useStore.getState().poppedPanels[id]) return; // it's in a window; redock via that path
  addPanelToDock(DOCK_API, id);
}
/** Hide (close) a docked panel. */
export function dockHidePanel(id: PanelId) {
  DOCK_API?.getPanel(id)?.api.close();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export default function DockLayout() {
  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    DOCK_API = api;
    const { dockLayout } = useStore.getState().settings;
    const popped = useStore.getState().poppedPanels;

    let restored = false;
    if (dockLayout) {
      try {
        api.fromJSON(dockLayout as Parameters<DockviewApi["fromJSON"]>[0]);
        restored = true;
      } catch {
        restored = false;
      }
    }
    if (!restored && api.panels.length === 0) {
      addPanelToDock(api, "visualizer");
      addPanelToDock(api, "hierarchy", { referencePanel: "visualizer", direction: "left" });
      addPanelToDock(api, "inspector", { referencePanel: "visualizer", direction: "right" });
      addPanelToDock(api, "perspective", { referencePanel: "visualizer", direction: "below" });
    }
    // Honour session pop-out state: a popped panel should not be in the dock.
    for (const id of PANEL_IDS) if (popped[id]) api.getPanel(id)?.api.close();

    const syncDocked = () => useStore.getState().setDockedPanels(api.panels.map((p) => p.id as PanelId));
    syncDocked();
    api.onDidLayoutChange(() => {
      syncDocked();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => useStore.getState().setDockLayout(api.toJSON()), 400);
    });
  };

  return (
    <div className="flex-1 min-h-0 twui-dock">
      <DockviewReact
        components={components}
        tabComponents={{ panelTab: PanelTab }}
        onReady={onReady}
        theme={themeAbyss}
      />
    </div>
  );
}
