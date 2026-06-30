import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { CcoDocs, CcoShorthand, CharacterDb, ContextDb, FactionContext, TwuiDocument } from "../types/twui";
import * as ipc from "../ipc/commands";
import { pickOpenFile, pickSaveFile } from "../ipc/dialog";
import {
  childByTag,
  componentMap,
  componentsSection,
  elementChildren,
  findComponentElement,
  fmtVec2,
  getAttr,
  getLayoutEngine,
  guidOf,
  hierarchyRoot,
  parseVec2,
  removeAttr,
  setAttr,
} from "../twui/doc";
import { encodeEntities } from "../twui/cco";
import { extractDataPack, LuaValue } from "../twui/lua";
import { collectTemplateIds } from "../twui/template";
import { defaultContext } from "../twui/context";
import { collectCreatorPaths } from "../twui/creator";
import { migrateLayout, MigrationResult } from "../twui/migrate";
import { collectScriptComponents, pageScriptId } from "../twui/script";
import { buildBlankDocument } from "../twui/skeleton";
import {
  addCallback,
  addCallbackProp,
  addComponentImage,
  addImageMetric,
  addNode,
  addState,
  componentGuidSet,
  deleteComponentImage,
  deleteNode,
  deleteState,
  duplicateNode,
  editChildAttr,
  extractSubtree,
  genGuid,
  moveCallbackProp,
  moveChild,
  moveNode,
  pasteSubtree,
  regenAllGuids,
  regenGuidSet,
  removeCallbackProp,
  removeChild,
  renameNode,
  replaceComponent,
  replaceHierarchyNode,
  sameHierarchyParent,
  setCallbackAttr,
  setCallbackPropAttr,
  subtreeGuidSet,
  SubtreeClip,
} from "../twui/mutate";
import { RawElement } from "../types/twui";

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** Visualizer interaction tool (shared with VisualizerPanel + the keybind registry). "view" is the
 *  Select tool (click-select + pan); labelled "Select" in the tool palette. */
export type Mode = "view" | "move" | "create" | "align" | "sim" | "tooltip";

/** Dockable panels that can be collapsed or popped out into their own OS window. */
export type PanelId = "hierarchy" | "inspector" | "perspective" | "visualizer" | "packfiles" | "layers";
export const PANEL_IDS: PanelId[] = ["hierarchy", "inspector", "perspective", "visualizer", "packfiles", "layers"];

/** Games the editor supports. The Settings table always offers these; the user
 *  points each at its own folders (no folder scanning / auto-detect). */
export const SUPPORTED_GAMES = ["3K", "WH3"];

/** Persisted user preferences (localStorage `twui-settings`). Document/runtime
 *  state is never persisted — only this subset (+ `background`/`view`). */
export interface Settings {
  /** actionId -> binding override (only set when the user rebinds; else the default). */
  keybinds: Record<string, string>;
  /** Default perspective applied on load (null = the built-in default). */
  perspective: FactionContext | null;
  visualizer: {
    defaultMode: Mode;
    showBounds: boolean;
    restoreView: boolean;
    /** Floating tool palette position (canvas-relative; null = default left-center) and hidden state. */
    palette: { x: number | null; y: number | null; hidden: boolean };
  };
  editor: { undoLimit: number; rememberLastFile: boolean };
  /** Opt-in experimental features, off by default. `versionConversion` reveals the
   *  layout-version converter (root component only) in the Inspector. `webAccess`
   *  configures the experimental HTTP server that serves the editor to a remote
   *  browser (bind/port/password are persisted for convenience; the server is not
   *  auto-started on launch). */
  experimental: {
    versionConversion: boolean;
    webAccess: {
      enabled: boolean;
      bind: "loopback" | "lan" | "custom";
      customIp: string;
      port: number;
      password: string;
    };
  };
  /** Appearance: colour scheme (system follows the OS), accent colour, and UI density.
   *  Applied by src/theme.ts. */
  theme: { mode: "system" | "light" | "dark"; accent: string; density: "comfortable" | "compact" };
  /** Serialized dockview layout (`api.toJSON()`), restored on load. Pop-out state is session-only. */
  dockLayout: unknown | null;
  /** Last-used read mode, restored on launch (so a pack location reopens in pack mode). */
  readMode: "folder" | "pack";
  /** Per-game configured paths: `outside` = a loose extracted data folder (folder
   *  mode); `data` = the game's install `data` folder of `.pack` files (pack mode).
   *  Selecting a game applies its path for the active read mode. */
  gamePaths: Record<string, { outside: string | null; data: string | null }>;
  lastGame: string | null;
  lastFile: string | null;
  /** Multi-file working set restored on launch (when `rememberLastFile` is on): every open
   *  file and the active one. Falls back to `lastFile` for blobs persisted before tabs. */
  openTabs: { path: string; fromPack: boolean; visible: boolean }[];
  activeTab: string | null;
}

const DEFAULT_VIEW: View = { zoom: 0.5, panX: 40, panY: 40 };

const DEFAULT_SETTINGS: Settings = {
  keybinds: {},
  perspective: null,
  visualizer: {
    defaultMode: "view",
    showBounds: false,
    restoreView: false,
    palette: { x: null, y: null, hidden: false },
  },
  editor: { undoLimit: 100, rememberLastFile: false },
  experimental: {
    versionConversion: false,
    webAccess: { enabled: false, bind: "loopback", customIp: "", port: 8787, password: "" },
  },
  theme: { mode: "system", accent: "#c9a227", density: "comfortable" },
  dockLayout: null,
  readMode: "folder",
  gamePaths: {},
  lastGame: null,
  lastFile: null,
  openTabs: [],
  activeTab: null,
};

/** Deep-merge the persisted prefs subset over the freshly-created store so older or
 *  partial persisted blobs gain any new fields' defaults (and methods are preserved). */
function mergePersisted(current: AppStore, persisted: unknown): AppStore {
  const p = (persisted ?? {}) as Partial<Pick<AppStore, "settings" | "background" | "view">>;
  const ps = (p.settings ?? {}) as Partial<Settings>;
  const settings: Settings = {
    ...current.settings,
    ...ps,
    visualizer: { ...current.settings.visualizer, ...(ps.visualizer ?? {}) },
    editor: { ...current.settings.editor, ...(ps.editor ?? {}) },
    experimental: {
      ...current.settings.experimental,
      ...(ps.experimental ?? {}),
      webAccess: {
        ...current.settings.experimental.webAccess,
        ...((ps.experimental as Partial<Settings["experimental"]> | undefined)?.webAccess ?? {}),
      },
    },
    theme: { ...current.settings.theme, ...(ps.theme ?? {}) },
    dockLayout: ps.dockLayout ?? current.settings.dockLayout,
    readMode: ps.readMode ?? current.settings.readMode,
    gamePaths: { ...(ps.gamePaths ?? {}) },
    keybinds: { ...(ps.keybinds ?? {}) },
    perspective: ps.perspective ?? null,
  };
  return {
    ...current,
    settings,
    showBounds: settings.visualizer.showBounds,
    background: "background" in p ? p.background ?? null : current.background,
    view: p.view ? { ...current.view, ...p.view } : current.view,
  };
}

/** The Lua script connected to the current page (auto-detected from script_id). */
interface ScriptConn {
  /** The panel's script_id (from ContextInitScriptObject), if any. */
  id: string | null;
  /** Resolved script path (data-root-relative, or the picked absolute path). */
  path: string | null;
  /** Script source text (drives the data-pack parser). */
  text: string | null;
  status: "none" | "connected" | "missing";
}

/** One open file in the Hierarchy tab strip. The active tab's full state lives in the
 *  top-level store fields; inactive tabs' state is parked in `inactiveDocs`. */
export interface TabMeta {
  id: string;
  fileName: string | null;
  filePath: string | null;
  packPath: string | null;
  dirty: boolean;
  /** Composited as a layer in the visualizer. The active tab always renders regardless; this
   *  only governs non-active files (opt-in overlays). Tab order is the layer z-order. */
  visible: boolean;
}

/** The per-file state swapped between the top-level store fields and `inactiveDocs` when the
 *  active tab changes. Mirrors the exact set `openFile` resets on load (plus multi-select). */
export interface PerDocSlice {
  doc: TwuiDocument | null;
  filePath: string | null;
  fileName: string | null;
  packPath: string | null;
  dirty: boolean;
  selectedGuid: string | null;
  selectedGuids: string[];
  revealed: Record<string, boolean>;
  previewState: Record<string, string>;
  undoStack: TwuiDocument[];
  redoStack: TwuiDocument[];
  templates: Record<string, TwuiDocument>;
  createdLayouts: Record<string, TwuiDocument>;
  scriptConn: ScriptConn;
  dataPackOverride: unknown;
  componentDataPacks: Record<string, unknown>;
  scriptDraft: string | null;
}

export interface AppStore {
  doc: TwuiDocument | null;
  filePath: string | null;
  fileName: string | null;
  dirty: boolean;
  selectedGuid: string | null;
  /** Multi-selection set (Align tool). The first entry is the alignment anchor; `selectedGuid`
   *  is the active one (for the Inspector). Single-select keeps this in sync as `[guid]`. */
  selectedGuids: string[];
  /** Component currently hovered (hierarchy row or canvas) — drives the highlight.
   *  Session- and window-local (not persisted, not mirrored across windows). */
  hoveredGuid: string | null;
  /** Open files for the Hierarchy tab strip (ordered). The active file's live state is the
   *  top-level fields; every other file's state is parked in `inactiveDocs`. */
  tabs: TabMeta[];
  /** Parked per-file state for every tab EXCEPT the active one, keyed by tab id. */
  inactiveDocs: Record<string, PerDocSlice>;
  /** Id of the active tab (one of `tabs`), or null when nothing is open. */
  activeTabId: string | null;
  /** A single dirty tab awaiting the unsaved-changes prompt before it closes (null = none). */
  pendingCloseTab: string | null;
  /** True when a window-close is awaiting the unsaved-changes prompt. */
  pendingClose: boolean;
  dataRoot: string | null;
  /** Reading from `.pack` archives (true) vs a loose folder (false). Session-only. */
  packMode: boolean;
  /** Source-relative path of a file opened from a pack (drives Save-As default name). */
  packPath: string | null;
  /** Every `.twui.xml` in the active pack(s) — backs the pack content browser. */
  packLayouts: string[];
  /** Whether pack mode includes Mod-type packs (false = vanilla only). */
  packIncludeMods: boolean;
  /** Absolute path of a single `.pack` overlaid on the base source, or null. */
  overlayPack: string | null;
  /** Bumped whenever the image source changes (overlay/game/data-root/mods) so the Visualizer and
   *  thumbnails drop cached images and re-fetch them (cache-busts the twuiimg:// URL too). */
  imageEpoch: number;
  /** Path to the user's RPFM `.ron` schema (decodes binary db tables), or null. */
  schemaPath: string | null;
  /** True until the initial boot `init()` (all game data) has fully loaded — drives
   *  the loading screen. */
  loading: boolean;
  status: string;
  view: View;
  undoStack: TwuiDocument[];
  redoStack: TwuiDocument[];

  /** Games available under `games/` and the active one. */
  games: string[];
  game: string | null;
  contextDb: ContextDb | null;
  context: FactionContext;
  /** Character generation templates + resolved portraits (Characters panel). */
  characterDb: CharacterDb | null;
  /** CCO symbol table from the game UI docs (Inspector binding hints). */
  ccoDocs: CcoDocs | null;
  /** Content-defined CCO shorthand macros (`ui/cco/*.json`) keyed by CCO type. */
  ccoShorthand: CcoShorthand | null;
  /** Scene roster: role-context name (e.g. `FactionLeaderContext`) -> template key. */
  characters: Record<string, string>;
  templates: Record<string, TwuiDocument>;
  /** Layouts embedded via `ComponentCreator`, keyed by their data-root-relative path. */
  createdLayouts: Record<string, TwuiDocument>;
  loc: Record<string, string>;
  scriptConn: ScriptConn;
  /** Non-destructive data-pack override (Script tweak menu) — wins over the parsed pack.
   *  Typed `unknown` (semantically `LuaValue | null`) so immer doesn't draft the recursive type. */
  dataPackOverride: unknown;
  /** Per-component script data packs (component guid -> its published table), for
   *  sub-scripted lists like the schemes list_box. Typed `unknown` for the same reason. */
  componentDataPacks: Record<string, unknown>;
  /** Raw-Lua working copy for the Script menu's Raw tab (null = use scriptConn.text). */
  scriptDraft: string | null;
  /** Non-persistent per-component state preview (Inspector → Visualizer). */
  previewState: Record<string, string>;
  /** Per-component force-show overrides from the hierarchy (session-only): reveal a
   *  component that a script/context binding would otherwise hide. Beats script visibility. */
  revealed: Record<string, boolean>;
  /** Quick-find palette: open state + mode ("find" by query, "refs" to selected guid). */
  searchOpen: boolean;
  searchMode: "find" | "refs";
  /** "New file" dialog open state. */
  newFileOpen: boolean;
  /** "Insert from file" picker: open state + an optional pre-seeded source (pack-relative path). */
  insertOpen: boolean;
  insertSource: string | null;
  backgrounds: string[];
  background: string | null;
  /** Active visualizer tool (left tool palette). */
  mode: Mode;
  /** Target render resolution for the visualizer; null = the doc's authored root size
   *  (no reflow). Session-only — never persisted, so a fresh doc always starts safe. */
  renderResolution: { w: number; h: number } | null;
  /** Whether the visualizer draws component bounds outlines (Perspective panel toggle). */
  showBounds: boolean;
  /** Editor-preview affordance: render a data-bound list's template once (as a layout
   *  skeleton) when no script pack is connected. Only affects non-simulation renders. */
  previewEmptyLists: boolean;
  /** User-set UI preference booleans (the game's `PrefAsBool`), e.g.
   *  `ui_alternative_unit_cards`. Drives preference-gated state/visibility in the preview. */
  uiPrefs: Record<string, boolean>;
  /** Panels currently popped out into their own OS window (session-only). */
  poppedPanels: Partial<Record<PanelId, boolean>>;
  /** Panel ids currently present in the dock (mirrored from dockview; drives the Panels menu). */
  dockedPanels: PanelId[];
  /** Copied component subtree (Copy/Paste), fresh-GUID-cloned on each paste. */
  clipboard: SubtreeClip | null;
  /** Persisted user preferences (Settings screen). */
  settings: Settings;

  init: (applyPrefs?: boolean) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  setKeybind: (actionId: string, binding: string | null) => void;
  resetKeybinds: () => void;
  setGame: (name: string) => Promise<void>;
  /** Set a game's configured `outside`/`data` path (persisted); pass null to clear. */
  setGamePath: (game: string, kind: "outside" | "data", path: string | null) => void;
  setCharacter: (role: string, templateKey: string | null) => void;
  connectScript: (path: string) => Promise<void>;
  clearScript: () => void;
  setDataPackOverride: (pack: LuaValue | null) => void;
  setScriptDraft: (text: string | null) => void;
  setPreviewState: (guid: string, name: string | null) => void;
  setRevealed: (guid: string, on: boolean) => void;
  openSearch: (mode?: "find" | "refs") => void;
  closeSearch: () => void;
  /** Create a blank, minimal-but-valid layout in a new untitled tab (saved via Save As). */
  newBlankFile: (opts: { version: number | string; name?: string }) => Promise<void>;
  /** Clone an existing file into a new untitled tab to modify (kept off-disk until Save As). */
  newFromFile: (path: string, fromPack: boolean) => Promise<void>;
  /** Insert a component subtree (with its component definitions) from another loaded document into
   *  the active doc under `parentGuid` (defaults to the hierarchy root). GUIDs are remapped. */
  insertSubtreeFrom: (foreignDoc: TwuiDocument, sourceGuid: string, parentGuid?: string) => Promise<void>;
  openNewFileDialog: () => void;
  closeNewFileDialog: () => void;
  /** Open the insert picker, optionally pre-seeded with a source (pack-relative path). */
  openInsertDialog: (source?: string) => void;
  closeInsertDialog: () => void;
  /** Internal: (re)load the active doc's scripts/templates/ComponentCreator sub-layouts. Shared by
   *  openFile and the new-file/insert flows so they all resolve referenced resources identically. */
  hydrateDocResources: (doc: TwuiDocument, label: string) => Promise<void>;
  /** Internal: adopt an in-memory doc as a new untitled tab (no on-disk path; dirty). */
  adoptUntitledDoc: (doc: TwuiDocument, fileName: string) => void;
  setBackground: (path: string | null) => void;
  setCampaign: (key: string) => void;
  setFaction: (key: string) => void;
  setCulture: (key: string) => void;
  setSubculture: (key: string) => void;
  openFile: (path: string, fromPack?: boolean) => Promise<void>;
  /** Open a file with a layer placement: "single" makes it the only composited file (active +
   *  editable, all others hidden); "top"/"bottom" add it as a visible reference layer at that
   *  z-order while keeping the file you were editing active. */
  openFileAs: (path: string, fromPack: boolean, mode: "single" | "top" | "bottom") => Promise<void>;
  openFileDialog: () => Promise<void>;
  /** Make `id` the active tab, parking the current one (lossless — no save prompt). */
  switchTab: (id: string) => void;
  /** Toggle whether a tab is composited as a layer in the visualizer (non-active files only;
   *  the active file always renders). */
  setLayerVisible: (id: string, visible: boolean) => void;
  /** Move a tab to a new index in `tabs`, which is the layer z-order (0 = bottom). */
  reorderLayer: (id: string, toIndex: number) => void;
  /** Close a tab. A dirty tab raises the unsaved-changes prompt first. */
  closeTab: (id: string) => void;
  /** Resolve the unsaved-changes prompt for closing a single dirty tab. */
  confirmCloseTab: (choice: "save" | "saveAs" | "discard" | "cancel") => Promise<void>;
  /** Resolve the unsaved-changes prompt for a window close; resolves true if the
   *  window should now actually close. */
  confirmClose: (choice: "save" | "saveAs" | "discard" | "cancel") => Promise<boolean>;
  /** Switch to pack mode, reading `.pack` files under `gameDir` (read-only).
   *  `includeMods` defaults to the current `packIncludeMods`. */
  setPackSource: (gameDir: string, includeMods?: boolean) => Promise<boolean>;
  /** Re-scan the current pack folder including/excluding Mod-type packs. */
  setPackIncludeMods: (on: boolean) => Promise<void>;
  /** Overlay a single `.pack` (absolute path) on the base source. */
  setOverlayPack: (path: string) => Promise<void>;
  /** Remove the single-pack overlay. */
  clearOverlayPack: () => Promise<void>;
  /** Point at the user's RPFM `.ron` schema and reload db/character/loc. */
  setSchemaPath: (path: string) => Promise<void>;
  save: () => Promise<void>;
  saveAs: (path: string) => Promise<void>;
  saveAsDialog: () => Promise<void>;
  setDataRoot: (path: string) => Promise<boolean>;
  select: (guid: string | null) => void;
  setHovered: (guid: string | null) => void;
  toggleSelect: (guid: string | null) => void;
  alignSelected: (axis: "x" | "y", refGuid: string) => void;
  centerBetween: (midGuid: string) => void;
  distributeSelected: (axis: "x" | "y") => void;
  nudgeSelected: (dx: number, dy: number) => void;
  swapSelectedOffsets: () => void;
  setStatus: (s: string) => void;
  setView: (v: Partial<View>) => void;

  mutate: (fn: (doc: TwuiDocument) => void) => void;
  /** Opt-in: convert the open layout to `target` version (renames/removes per migrate.ts).
   *  Goes through `mutate` so it is a single undoable step. Returns a summary for the caller. */
  migrateVersion: (target: number) => MigrationResult | null;
  editAttr: (guid: string, key: string, value: string) => void;
  editAttrs: (guid: string, updates: Record<string, string>) => void;
  /** Edit an attribute on a guid-less container child (e.g. an `<imagemetrics><image>`) by
   *  container + element index — the guid-based `editAttr` can't reach these. */
  editChildAttr: (parentGuid: string, containerTag: string, index: number, key: string, value: string) => void;
  editLayoutEngineAttr: (guid: string, key: string, value: string) => void;
  addLayoutEngine: (guid: string) => void;
  setCallbackFunc: (guid: string, index: number, value: string) => void;
  // Structural CRUD below the component level (states / component images / image-metrics /
  // callbacks). Add/delete by element-index within the parent container; reorder via moveChild.
  addState: (compGuid: string) => void;
  deleteState: (compGuid: string, index: number) => void;
  addComponentImage: (compGuid: string) => void;
  deleteComponentImage: (compGuid: string, index: number) => void;
  addImageMetric: (stateGuid: string, ciGuid: string | undefined) => void;
  addCallback: (compGuid: string) => void;
  setCallbackAttr: (compGuid: string, containerTag: string, index: number, key: string, value: string) => void;
  // Callback params (<child_m_user_properties><property>), addressed by callback + property index.
  addCallbackProp: (compGuid: string, containerTag: string, cbIndex: number) => void;
  setCallbackPropAttr: (compGuid: string, containerTag: string, cbIndex: number, propIndex: number, key: string, value: string) => void;
  moveCallbackProp: (compGuid: string, containerTag: string, cbIndex: number, propIndex: number, dir: -1 | 1) => void;
  removeCallbackProp: (compGuid: string, containerTag: string, cbIndex: number, propIndex: number) => void;
  moveChild: (parentGuid: string, containerTag: string, index: number, dir: -1 | 1) => void;
  removeChild: (parentGuid: string, containerTag: string, index: number) => void;
  toggleVisible: (guid: string) => void;
  beginDrag: () => void;
  liveSetOffset: (guid: string, x: number, y: number) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  regenGuids: () => void;
  regenComponentGuids: (guid: string) => void;
  regenSubtreeGuids: (guid: string) => void;
  setDockLayout: (json: unknown) => void;
  setDockedPanels: (ids: PanelId[]) => void;
  setPanelPopped: (id: PanelId, popped: boolean) => void;
  setShowBounds: (v: boolean) => void;
  setPreviewEmptyLists: (v: boolean) => void;
  setUiPref: (key: string, value: boolean) => void;
  setMode: (m: Mode) => void;
  setRenderResolution: (r: { w: number; h: number } | null) => void;
  copy: () => void;
  paste: () => void;
  createAt: (parentGuid: string | null, x: number, y: number) => void;
  addChild: (parentGuid: string, tag: string) => void;
  rename: (guid: string, newId: string) => void;
  move: (guid: string, newParentGuid: string, beforeGuid: string | null) => void;
  applyComponentRaw: (guid: string, el: RawElement) => void;
  applyHierarchyRaw: (guid: string, el: RawElement) => void;
  undo: () => void;
  redo: () => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The top-level store fields that belong to ONE open file. `snapshotActive`/`hydrate` move
 *  them between the live state and a parked `PerDocSlice`; one list keeps them from drifting. */
const PER_DOC_FIELDS = [
  "doc", "filePath", "fileName", "packPath", "dirty",
  "selectedGuid", "selectedGuids", "revealed", "previewState",
  "undoStack", "redoStack", "templates", "createdLayouts",
  "scriptConn", "dataPackOverride", "componentDataPacks", "scriptDraft",
] as const;

type Mutable = Record<string, unknown>;

/** Copy the active file's per-doc fields into a parked slice (references — immer finalizes
 *  them once they're reachable from `inactiveDocs`). */
function snapshotActive(s: AppStore): PerDocSlice {
  const out: Mutable = {};
  for (const k of PER_DOC_FIELDS) out[k] = (s as unknown as Mutable)[k];
  return out as unknown as PerDocSlice;
}

/** Write a parked slice back into the top-level (active) fields. */
function hydrate(s: AppStore, slice: PerDocSlice): void {
  const src = slice as unknown as Mutable;
  const dst = s as unknown as Mutable;
  for (const k of PER_DOC_FIELDS) dst[k] = src[k];
}

/** The empty-document state (no file open) — used when the last tab closes. */
function emptySlice(): PerDocSlice {
  return {
    doc: null, filePath: null, fileName: null, packPath: null, dirty: false,
    selectedGuid: null, selectedGuids: [], revealed: {}, previewState: {},
    undoStack: [], redoStack: [], templates: {}, createdLayouts: {},
    scriptConn: { id: null, path: null, text: null, status: "none" },
    dataPackOverride: null, componentDataPacks: {}, scriptDraft: null,
  };
}

/** Set the dirty flag on both the live state and the active tab's strip metadata. */
function setActiveDirty(s: AppStore, v: boolean): void {
  s.dirty = v;
  const t = s.tabs.find((t) => t.id === s.activeTabId);
  if (t) t.dirty = v;
}

/** Persist the working set (open files + active) when the user opted into restore-on-launch. */
function rememberTabs(s: AppStore): void {
  if (!s.settings.editor.rememberLastFile) return;
  s.settings.openTabs = s.tabs
    .map((t) =>
      t.packPath
        ? { path: t.packPath, fromPack: true, visible: t.visible }
        : { path: t.filePath ?? "", fromPack: false, visible: t.visible }
    )
    .filter((t) => t.path);
  s.settings.activeTab = s.activeTabId;
}

/** Remove a tab, activating a neighbour (prefer the right) when the active tab is closed, or
 *  clearing to the empty state when it was the last one. */
function removeTab(s: AppStore, id: string): void {
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  s.tabs.splice(idx, 1);
  delete s.inactiveDocs[id];
  if (s.activeTabId !== id) {
    rememberTabs(s);
    return;
  }
  const next = s.tabs[idx] ?? s.tabs[idx - 1];
  if (next) {
    const slice = s.inactiveDocs[next.id];
    if (slice) {
      hydrate(s, slice);
      delete s.inactiveDocs[next.id];
    }
    s.activeTabId = next.id;
    s.hoveredGuid = null;
    s.status = `Switched to ${next.fileName ?? "(untitled)"}`;
  } else {
    hydrate(s, emptySlice());
    s.activeTabId = null;
    s.status = "Ready";
  }
  rememberTabs(s);
}

export const useStore = create<AppStore>()(
  persist(
    immer((set, get) => ({
    doc: null,
    filePath: null,
    fileName: null,
    dirty: false,
    selectedGuid: null,
    selectedGuids: [],
    hoveredGuid: null,
    tabs: [],
    inactiveDocs: {},
    activeTabId: null,
    pendingCloseTab: null,
    pendingClose: false,
    poppedPanels: {},
    dockedPanels: [],
    dataRoot: null,
    packMode: false,
    packPath: null,
    packLayouts: [],
    imageEpoch: 0,
    packIncludeMods: false,
    overlayPack: null,
    schemaPath: null,
    loading: true,
    status: "Ready",
    view: { ...DEFAULT_VIEW },
    undoStack: [],
    redoStack: [],

    games: [...SUPPORTED_GAMES],
    game: null,
    contextDb: null,
    context: { campaign: "", faction: "", culture: "", subculture: "" },
    characterDb: null,
    ccoDocs: null,
    ccoShorthand: null,
    characters: {},
    templates: {},
    createdLayouts: {},
    loc: {},
    scriptConn: { id: null, path: null, text: null, status: "none" },
    dataPackOverride: null,
    componentDataPacks: {},
    scriptDraft: null,
    previewState: {},
    revealed: {},
    searchOpen: false,
    searchMode: "find",
    newFileOpen: false,
    insertOpen: false,
    insertSource: null,
    backgrounds: [],
    background: null,
    mode: DEFAULT_SETTINGS.visualizer.defaultMode,
    showBounds: DEFAULT_SETTINGS.visualizer.showBounds,
    previewEmptyLists: true,
    uiPrefs: {},
    renderResolution: null,
    clipboard: null,
    settings: DEFAULT_SETTINGS,

    setBackground: (path) =>
      set((s) => {
        s.background = path;
      }),

    updateSettings: (patch) =>
      set((s) => {
        s.settings = { ...s.settings, ...patch };
      }),

    setKeybind: (actionId, binding) =>
      set((s) => {
        if (binding === null) delete s.settings.keybinds[actionId];
        else s.settings.keybinds[actionId] = binding;
      }),

    resetKeybinds: () =>
      set((s) => {
        s.settings.keybinds = {};
      }),

    setGame: async (name) => {
      set((s) => {
        s.game = name;
        s.settings.lastGame = name; // remembered across sessions
      });
      // Apply this game's configured folder for the current read mode; if only the
      // other folder is set, switch to it; if neither is set, just mark it active
      // and prompt (no folder scanning — the user picks the two folders explicitly).
      const gp = get().settings.gamePaths[name];
      const wantPack = get().packMode;
      try {
        if (wantPack && gp?.data) await get().setPackSource(gp.data);
        else if (!wantPack && gp?.outside) await get().setDataRoot(gp.outside);
        else if (gp?.data) await get().setPackSource(gp.data);
        else if (gp?.outside) await get().setDataRoot(gp.outside);
        else
          set((s) => {
            s.status = `Set an Outside or Data folder for ${name} in Settings → Game & Data`;
          });
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
      }
    },

    setGamePath: (game, kind, path) =>
      set((s) => {
        const cur = s.settings.gamePaths[game] ?? { outside: null, data: null };
        s.settings.gamePaths[game] = { ...cur, [kind]: path };
      }),

    setCharacter: (role, templateKey) =>
      set((s) => {
        if (templateKey) s.characters[role] = templateKey;
        else delete s.characters[role];
      }),

    connectScript: async (path) => {
      try {
        const text = await ipc.readScript(path);
        set((s) => {
          s.scriptConn = { id: s.scriptConn.id, path, text, status: "connected" };
          s.dataPackOverride = null;
          s.scriptDraft = null;
          s.status = `Connected script: ${baseName(path)}`;
        });
      } catch (e) {
        set((s) => {
          s.status = `Script error: ${e}`;
        });
      }
    },

    clearScript: () =>
      set((s) => {
        s.scriptConn = { id: s.scriptConn.id, path: null, text: null, status: "none" };
        s.dataPackOverride = null;
        s.scriptDraft = null;
      }),

    setDataPackOverride: (pack) =>
      set((s) => {
        s.dataPackOverride = pack;
      }),

    setScriptDraft: (text) =>
      set((s) => {
        s.scriptDraft = text;
      }),

    setRevealed: (guid, on) =>
      set((s) => {
        if (on) s.revealed[guid] = true;
        else delete s.revealed[guid];
      }),
    setPreviewState: (guid, name) =>
      set((s) => {
        if (name === null) delete s.previewState[guid];
        else s.previewState[guid] = name;
      }),

    openSearch: (mode = "find") =>
      set((s) => {
        s.searchMode = mode;
        s.searchOpen = true;
      }),

    closeSearch: () =>
      set((s) => {
        s.searchOpen = false;
      }),

    init: async (applyPrefs = true) => {
      // The backend reads are independent — load them concurrently so startup is
      // bounded by the slowest, not their sum. Each settles into the store on its own.
      const load = <T>(p: Promise<T>, apply: (s: AppStore, v: T) => void, onErr?: string) =>
        p.then(
          (v) => set((s) => apply(s, v)),
          (e) => onErr && set((s) => { s.status = `${onErr}: ${e}`; })
        );

      await Promise.all([
        load(ipc.getDataRoot(), (s, root) => { s.dataRoot = root; }, "Failed to read data root"),
        load(ipc.getSchemaPath(), (s, p) => { s.schemaPath = p; }),
        load(ipc.loadContextDb(), (s, db) => { s.contextDb = db; }, "Failed to load DB"),
        load(ipc.loadCharacterDb(), (s, cdb) => { s.characterDb = cdb; }),
        load(ipc.loadCcoDocs(), (s, docs) => { s.ccoDocs = docs; }),
        load(ipc.loadCcoShorthand(), (s, sh) => { s.ccoShorthand = sh; }),
        load(ipc.loadLoc(), (s, loc) => { s.loc = loc; }),
        load(ipc.listBackgrounds(), (s, backgrounds) => {
          s.backgrounds = backgrounds;
          // Keep a persisted/user-chosen background if it still exists; else default.
          if (!s.background || !backgrounds.includes(s.background)) {
            s.background = backgrounds[0] ?? null;
          }
        }),
      ]);

      // Apply persisted preferences (after the loads above so games/db are known).
      const st = get();
      if (st.settings.perspective) {
        set((s) => { s.context = { ...st.settings.perspective! }; });
      }
      // No persisted perspective (or it points at a campaign this DB lacks) -> derive a
      // sensible default from the loaded DB rather than assuming a specific game's keys.
      {
        const cur = get();
        const valid = cur.contextDb?.campaigns.includes(cur.context.campaign);
        if (!st.settings.perspective || !valid) {
          const ctx = defaultContext(cur.contextDb);
          set((s) => { s.context = ctx; });
        }
      }
      if (!st.settings.visualizer.restoreView) {
        set((s) => { s.view = { ...DEFAULT_VIEW }; });
      }
      // Seed the active tool from the persisted default (parity with the old panel useState).
      set((s) => { s.mode = st.settings.visualizer.defaultMode; });

      // Restore the last game in its saved read mode (so a saved pack location reopens
      // in pack mode). Only re-apply when there's actually something to switch to,
      // avoiding a redundant reload for the plain folder-default case.
      const lg = st.settings.lastGame;
      if (applyPrefs && lg && st.games.includes(lg)) {
        const gp = st.settings.gamePaths[lg];
        const wantPack = st.settings.readMode === "pack" && !!gp?.data;
        const wantCustomFolder = st.settings.readMode !== "pack" && !!gp?.outside;
        if (wantPack || wantCustomFolder || lg !== st.game) {
          set((s) => { s.packMode = wantPack; }); // steer setGame's branch
          await get().setGame(lg); // setGame reloads with applyPrefs=false
        }
      }

      // Reopen the last working set on first launch, when opted in and nothing is open yet.
      const cur = get();
      if (applyPrefs && cur.settings.editor.rememberLastFile && !cur.doc && cur.tabs.length === 0) {
        // Prefer the saved multi-file set; fall back to the single `lastFile` for older blobs.
        const saved =
          cur.settings.openTabs.length > 0
            ? cur.settings.openTabs
            : cur.settings.lastFile
              ? [{ path: cur.settings.lastFile, fromPack: false, visible: false }]
              : [];
        for (const t of saved) {
          await get().openFile(t.path, t.fromPack); // sequential: each adds + activates a tab
        }
        // Restore which files were composited as layers (openFile creates tabs hidden).
        set((s) => {
          for (const t of saved) {
            if (!t.visible) continue;
            const id = `${t.fromPack ? "pack" : "file"}:${t.path}`;
            const tab = s.tabs.find((x) => x.id === id);
            if (tab) tab.visible = true;
          }
        });
        const active = cur.settings.activeTab;
        if (active && get().tabs.some((x) => x.id === active)) get().switchTab(active);
      }
    },

    setCampaign: (key) =>
      set((s) => {
        s.context.campaign = key;
        const factions = s.contextDb?.campaign_factions[key];
        if (factions && !factions.includes(s.context.faction)) {
          // Current faction isn't valid here; fall back to the first available (sorted).
          const next = factions[0];
          if (next) {
            s.context.faction = next;
            const f = s.contextDb?.factions.find((x) => x.key === next);
            if (f?.subculture) {
              s.context.subculture = f.subculture;
              const sc = s.contextDb?.subcultures.find((x) => x.subculture === f.subculture);
              if (sc?.culture) s.context.culture = sc.culture;
            }
          }
        }
      }),

    setFaction: (key) =>
      set((s) => {
        s.context.faction = key;
        const f = s.contextDb?.factions.find((x) => x.key === key);
        if (f?.subculture) {
          s.context.subculture = f.subculture;
          const sc = s.contextDb?.subcultures.find((x) => x.subculture === f.subculture);
          if (sc?.culture) s.context.culture = sc.culture;
        }
      }),

    setCulture: (key) =>
      set((s) => {
        s.context.culture = key;
      }),

    setSubculture: (key) =>
      set((s) => {
        s.context.subculture = key;
        const sc = s.contextDb?.subcultures.find((x) => x.subculture === key);
        if (sc?.culture) s.context.culture = sc.culture;
      }),

    openFile: async (path, fromPack = false) => {
      // Stable per-file identity (drive letter colons in `path` are preserved after the prefix).
      const id = `${fromPack ? "pack" : "file"}:${path}`;
      // Already open -> focus its tab; opening never reloads or discards another file.
      if (get().tabs.some((t) => t.id === id)) {
        get().switchTab(id);
        return;
      }
      set((s) => {
        // Park the current active file (if any) before this one becomes active.
        if (s.activeTabId) s.inactiveDocs[s.activeTabId] = snapshotActive(s);
        s.tabs.push({
          id,
          fileName: baseName(path),
          filePath: fromPack ? null : path,
          packPath: fromPack ? path : null,
          dirty: false,
          // Opt-in overlay: a freshly opened file isn't composited until toggled on (it's drawn
          // anyway while it's the active tab).
          visible: false,
        });
        s.activeTabId = id;
        s.status = `Loading ${baseName(path)}…`;
      });
      try {
        // Pack files are read by source-relative path; loose files by absolute path.
        const doc = fromPack ? await ipc.readLayoutRel(path) : await ipc.readLayout(path);
        set((s) => {
          s.doc = doc;
          // No on-disk path for pack files -> Save falls through to Save-As.
          s.filePath = fromPack ? null : path;
          s.packPath = fromPack ? path : null;
          s.fileName = baseName(path);
          s.dirty = false;
          s.selectedGuid = null;
          s.selectedGuids = [];
          s.revealed = {};
          s.undoStack = [];
          s.redoStack = [];
          s.templates = {};
          s.createdLayouts = {};
          s.scriptConn = { id: null, path: null, text: null, status: "none" };
          s.dataPackOverride = null;
          s.componentDataPacks = {};
          s.scriptDraft = null;
          s.previewState = {};
          s.status = `Loaded ${baseName(path)}`;
          if (!fromPack && s.settings.editor.rememberLastFile) s.settings.lastFile = path;
          rememberTabs(s);
        });
        await get().hydrateDocResources(doc, baseName(path));
      } catch (e) {
        set((s) => {
          s.status = `Error: ${e}`;
          // The file failed to load -> drop the tab we optimistically added.
          removeTab(s, id);
        });
      }
    },

    openFileAs: async (path, fromPack, mode) => {
      const prevActive = get().activeTabId;
      const id = `${fromPack ? "pack" : "file"}:${path}`;
      // openFile fully loads the doc + script/templates/sub-layouts before resolving, and leaves
      // the new tab active — so it's safe to re-park / switch away afterwards.
      await get().openFile(path, fromPack);
      if (!get().tabs.some((t) => t.id === id)) return; // load failed (tab was dropped)
      set((s) => {
        if (mode === "single") {
          // Only this file composites; keep it active/editable.
          for (const t of s.tabs) if (t.id !== id) t.visible = false;
        } else {
          // Visible reference layer at the chosen z-order (tabs index 0 = bottom).
          const from = s.tabs.findIndex((t) => t.id === id);
          if (from >= 0) {
            const [tab] = s.tabs.splice(from, 1);
            tab.visible = true;
            s.tabs.splice(mode === "top" ? s.tabs.length : 0, 0, tab);
          }
        }
        rememberTabs(s);
      });
      // For layer placements, keep the file you were editing active (the new one is reference).
      if (mode !== "single" && prevActive && prevActive !== id && get().tabs.some((t) => t.id === prevActive)) {
        get().switchTab(prevActive);
      }
    },

    save: async () => {
      const { doc, filePath } = get();
      if (!doc) return;
      // No on-disk path (e.g. opened from a pack) -> prompt for a destination.
      if (!filePath) {
        await get().saveAsDialog();
        return;
      }
      try {
        await ipc.saveLayout(filePath, doc);
        set((s) => {
          setActiveDirty(s, false);
          s.status = `Saved ${baseName(filePath)}`;
        });
      } catch (e) {
        set((s) => {
          s.status = `Save error: ${e}`;
        });
      }
    },

    saveAs: async (path) => {
      const { doc } = get();
      if (!doc) return;
      try {
        await ipc.saveLayout(path, doc);
        set((s) => {
          s.filePath = path;
          s.packPath = null; // Save-As always writes a loose, on-disk file.
          s.fileName = baseName(path);
          // The active tab now points at the saved-on-disk file: update its identity + metadata.
          const newId = `file:${path}`;
          const t = s.tabs.find((x) => x.id === s.activeTabId);
          if (t) {
            t.id = newId;
            t.fileName = baseName(path);
            t.filePath = path;
            t.packPath = null;
            t.dirty = false;
          }
          s.activeTabId = newId;
          s.dirty = false;
          s.status = `Saved ${baseName(path)}`;
          rememberTabs(s);
        });
      } catch (e) {
        set((s) => {
          s.status = `Save error: ${e}`;
        });
      }
    },

    // Open/Save-As dialogs live here so the toolbar and keybinds share one path.
    openFileDialog: async () => {
      const path = await pickOpenFile({
        filters: [{ name: "TWUI Layout", extensions: ["xml"] }],
        defaultPath: get().dataRoot ?? undefined,
      });
      if (path) await get().openFile(path);
    },

    hydrateDocResources: async (doc, label) => {
      // Auto-connect the page's backing Lua script (from its script_id).
      const scriptId = pageScriptId(doc);
      if (scriptId) {
        try {
          const hit = await ipc.findScript(scriptId);
          set((s) => {
            s.scriptConn = hit
              ? { id: scriptId, path: hit.path, text: hit.text, status: "connected" }
              : { id: scriptId, path: null, text: null, status: "missing" };
          });
        } catch {
          set((s) => {
            s.scriptConn = { id: scriptId, path: null, text: null, status: "missing" };
          });
        }
      }
      // Per-component scripts (a sub-component with its own ContextInitScriptObject,
      // e.g. the schemes list_box): find + parse each published table so the list
      // resolves against its own pack. Best-effort; keyed by component guid.
      const scriptComps = collectScriptComponents(doc);
      if (scriptComps.length) {
        const packs: Record<string, unknown> = {};
        await Promise.all(
          scriptComps.map(async ({ guid, scriptId: sid }) => {
            try {
              const hit = await ipc.findScript(sid);
              const pack = hit?.text ? extractDataPack(hit.text, sid) : null;
              if (pack != null) packs[guid] = pack;
            } catch {
              /* per-component scripts are optional */
            }
          })
        );
        if (Object.keys(packs).length) set((s) => { s.componentDataPacks = packs; });
      }
      // Resolve referenced templates for the visualizer (best-effort).
      const ids = collectTemplateIds(doc);
      if (ids.length) {
        try {
          const templates = await ipc.loadTemplates(ids);
          set((s) => {
            s.templates = templates;
            const n = Object.keys(templates).length;
            s.status = `Loaded ${label} (${n}/${ids.length} templates)`;
          });
        } catch {
          /* templates are optional; ignore */
        }
      }
      // Resolve ComponentCreator sub-layouts, recursively (sub-layouts may embed
      // more). Depth-capped; a `visited` set prevents reloading/cycles.
      try {
        const created: Record<string, TwuiDocument> = {};
        let frontier = collectCreatorPaths(doc);
        for (let depth = 0; depth < 4 && frontier.length; depth++) {
          const want = frontier.filter((p) => !(p in created));
          if (!want.length) break;
          const loaded = await ipc.loadLayouts(want);
          Object.assign(created, loaded);
          frontier = Object.values(loaded).flatMap((sub) => collectCreatorPaths(sub));
        }
        if (Object.keys(created).length) set((s) => { s.createdLayouts = created; });
        // Sub-layouts reference their own templates (e.g. the court slot's `frame` is a
        // `part_of_template` child of the `character_slot` template). Load those too so
        // templated children resolve their visuals.
        const subIds = [...new Set(Object.values(created).flatMap(collectTemplateIds))];
        const have = get().templates;
        const missing = subIds.filter((id) => !(id in have));
        if (missing.length) {
          const extra = await ipc.loadTemplates(missing);
          set((s) => { s.templates = { ...s.templates, ...extra }; });
        }
      } catch {
        /* ComponentCreator layouts are optional; ignore */
      }
    },

    adoptUntitledDoc: (doc, fileName) =>
      set((s) => {
        // Park the current active file (if any) before the new one becomes active.
        if (s.activeTabId) s.inactiveDocs[s.activeTabId] = snapshotActive(s);
        const id = `new:${genGuid()}`;
        // Untitled: no filePath/packPath -> Save routes to Save-As; rememberTabs skips it.
        s.tabs.push({ id, fileName, filePath: null, packPath: null, dirty: true, visible: false });
        s.activeTabId = id;
        s.doc = doc;
        s.filePath = null;
        s.packPath = null;
        s.fileName = fileName;
        s.dirty = true;
        s.selectedGuid = null;
        s.selectedGuids = [];
        s.revealed = {};
        s.undoStack = [];
        s.redoStack = [];
        s.templates = {};
        s.createdLayouts = {};
        s.scriptConn = { id: null, path: null, text: null, status: "none" };
        s.dataPackOverride = null;
        s.componentDataPacks = {};
        s.scriptDraft = null;
        s.previewState = {};
        s.status = `New: ${fileName}`;
        rememberTabs(s);
      }),

    newBlankFile: async (opts) => {
      const res = get().renderResolution;
      const width = res?.w ?? 1920;
      const height = res?.h ?? 1080;
      const raw = (opts.name ?? "").trim() || "untitled";
      const fileName = /\.xml$/i.test(raw) ? raw : `${raw}.twui.xml`;
      let doc: TwuiDocument;
      try {
        doc = await buildBlankDocument({ version: opts.version, width, height });
      } catch (e) {
        set((s) => {
          s.status = `New file error: ${e}`;
          s.newFileOpen = false;
        });
        return;
      }
      get().adoptUntitledDoc(doc, fileName);
      set((s) => { s.newFileOpen = false; });
    },

    newFromFile: async (path, fromPack) => {
      try {
        const doc = fromPack ? await ipc.readLayoutRel(path) : await ipc.readLayout(path);
        const fileName = `(copy) ${baseName(path)}`;
        get().adoptUntitledDoc(doc, fileName);
        await get().hydrateDocResources(doc, fileName);
      } catch (e) {
        set((s) => { s.status = `New from file error: ${e}`; });
      }
    },

    insertSubtreeFrom: async (foreignDoc, sourceGuid, parentGuid) => {
      const cur = get().doc;
      if (!cur) return;
      const clip = extractSubtree(foreignDoc, sourceGuid);
      if (!clip) {
        set((s) => { s.status = "Insert: component not found in source"; });
        return;
      }
      const rootEl = hierarchyRoot(cur);
      const target = parentGuid ?? (rootEl ? guidOf(rootEl) : undefined);
      if (!target) {
        set((s) => { s.status = "Insert: no target parent in the current layout"; });
        return;
      }
      // pasteSubtree clones + regenerates every GUID, so cross-file inserts can't collide.
      let newGuid: string | undefined;
      get().mutate((doc) => {
        newGuid = pasteSubtree(doc, target, clip);
      });
      if (!newGuid) {
        set((s) => { s.status = "Insert failed"; });
        return;
      }
      get().select(newGuid);
      // The inserted part may reference templates / ComponentCreator layouts the active doc didn't
      // use yet — reload resources from the merged doc so they render.
      const after = get().doc;
      if (after) await get().hydrateDocResources(after, get().fileName ?? "layout");
      set((s) => { s.status = "Inserted component"; });
    },

    openNewFileDialog: () => set((s) => { s.newFileOpen = true; }),
    closeNewFileDialog: () => set((s) => { s.newFileOpen = false; }),
    openInsertDialog: (source) =>
      set((s) => {
        s.insertOpen = true;
        s.insertSource = source ?? null;
      }),
    closeInsertDialog: () =>
      set((s) => {
        s.insertOpen = false;
        s.insertSource = null;
      }),

    switchTab: (id) =>
      set((s) => {
        if (id === s.activeTabId) return;
        const target = s.inactiveDocs[id];
        if (!target) return; // unknown tab — ignore
        // Park the current active file, then swap the target's parked state into the live fields.
        if (s.activeTabId) s.inactiveDocs[s.activeTabId] = snapshotActive(s);
        hydrate(s, target);
        delete s.inactiveDocs[id];
        s.activeTabId = id;
        s.hoveredGuid = null;
        s.status = `Switched to ${target.fileName ?? "(untitled)"}`;
        rememberTabs(s);
      }),

    setLayerVisible: (id, visible) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab) return;
        tab.visible = visible;
        rememberTabs(s);
      }),

    reorderLayer: (id, toIndex) =>
      set((s) => {
        const from = s.tabs.findIndex((t) => t.id === id);
        if (from < 0) return;
        const clamped = Math.max(0, Math.min(toIndex, s.tabs.length - 1));
        if (from === clamped) return;
        const [tab] = s.tabs.splice(from, 1);
        s.tabs.splice(clamped, 0, tab);
        rememberTabs(s);
      }),

    closeTab: (id) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab) return;
      // A dirty tab prompts first (resolved by confirmCloseTab); a clean one closes immediately.
      if (tab.dirty) {
        set((s) => {
          s.pendingCloseTab = id;
        });
        return;
      }
      set((s) => {
        removeTab(s, id);
      });
    },

    confirmCloseTab: async (choice) => {
      const id = get().pendingCloseTab;
      if (!id) return;
      if (choice === "cancel") {
        set((s) => {
          s.pendingCloseTab = null;
        });
        return;
      }
      if (choice === "discard") {
        set((s) => {
          s.pendingCloseTab = null;
          removeTab(s, id);
        });
        return;
      }
      // Save / Save-As act through the normal path, which targets the ACTIVE file — so make the
      // tab being closed active first.
      if (get().activeTabId !== id) get().switchTab(id);
      if (choice === "save") await get().save();
      else if (choice === "saveAs") await get().saveAsDialog();
      // Close once the save actually cleared the dirty flag (a cancelled Save-As leaves it dirty
      // -> keep the prompt up). Remove the now-active tab (its id is stable across save).
      if (!get().dirty) {
        set((s) => {
          const rid = s.activeTabId ?? id;
          s.pendingCloseTab = null;
          removeTab(s, rid);
        });
      }
    },

    confirmClose: async (choice) => {
      if (choice === "cancel") {
        set((s) => {
          s.pendingClose = false;
        });
        return false;
      }
      if (choice !== "discard") {
        // Persist EVERY dirty tab (the window holds them all), each through the normal active
        // path. Stop if any save is cancelled (e.g. a Save-As dialog dismissed) -> stay open.
        const dirtyIds = get().tabs.filter((t) => t.dirty).map((t) => t.id);
        for (const id of dirtyIds) {
          if (get().activeTabId !== id) get().switchTab(id);
          if (choice === "saveAs") await get().saveAsDialog();
          else await get().save();
          if (get().dirty) return false; // this tab's save was cancelled
        }
      }
      // Close on discard, or once no tab is dirty any longer.
      if (choice === "discard" || !get().tabs.some((t) => t.dirty)) {
        set((s) => {
          s.pendingClose = false;
        });
        return true;
      }
      return false; // a save was cancelled -> stay open
    },

    saveAsDialog: async () => {
      if (!get().doc) return;
      // Suggest the pack file's own name when saving a pack-opened file.
      const suggested = get().packPath ? baseName(get().packPath!) : undefined;
      const path = await pickSaveFile({
        filters: [{ name: "TWUI Layout", extensions: ["xml"] }],
        defaultPath: get().dataRoot ?? undefined,
        defaultFileName: suggested,
      });
      if (path) await get().saveAs(path);
    },

    setDataRoot: async (path) => {
      try {
        await ipc.setDataRoot(path);
        set((s) => {
          s.dataRoot = path;
          s.packMode = false;
          s.packLayouts = [];
          s.overlayPack = null;
          s.imageEpoch++;
          s.settings.readMode = "folder";
          s.status = `Data root: ${path}`;
        });
        await get().init(false);
        return true;
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
        return false;
      }
    },

    setPackSource: async (gameDir, includeMods) => {
      const withMods = includeMods ?? get().packIncludeMods;
      try {
        set((s) => {
          s.status = `Indexing packs in ${gameDir}…`;
        });
        await ipc.setPackSource(gameDir, withMods);
        set((s) => {
          s.packMode = true;
          s.dataRoot = gameDir;
          s.packIncludeMods = withMods;
          s.overlayPack = null; // backend clears overlay on base change
          s.settings.readMode = "pack";
        });
        // Reload game data (db/cco/loc/templates resolve through the pack now).
        await get().init(false);
        const layouts = await ipc.listLayouts();
        set((s) => {
          s.packLayouts = layouts;
          s.imageEpoch++;
          s.status = `Pack mode (${withMods ? "with mods" : "vanilla"}): ${layouts.length} layouts`;
        });
        return true;
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
        return false;
      }
    },

    setPackIncludeMods: async (on) => {
      const dir = get().dataRoot;
      if (!dir) return;
      await get().setPackSource(dir, on);
    },

    setOverlayPack: async (path) => {
      try {
        await ipc.setOverlayPack(path);
        const layouts = await ipc.listLayouts();
        set((s) => {
          s.overlayPack = path;
          s.packLayouts = layouts;
          s.imageEpoch++;
          s.status = `Overlay: ${baseName(path)} (${layouts.length} layouts)`;
        });
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
      }
    },

    clearOverlayPack: async () => {
      try {
        await ipc.clearOverlayPack();
        const layouts = await ipc.listLayouts();
        set((s) => {
          s.overlayPack = null;
          s.packLayouts = layouts;
          s.imageEpoch++;
          s.status = `Overlay cleared (${layouts.length} layouts)`;
        });
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
      }
    },

    setSchemaPath: async (path) => {
      try {
        await ipc.setSchemaPath(path);
        set((s) => {
          s.schemaPath = path;
          s.status = `RPFM schema: ${baseName(path)}`;
        });
        // Reload db/character/loc now that the schema can decode binary tables.
        await get().init(false);
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
      }
    },

    select: (guid) =>
      set((s) => {
        s.selectedGuid = guid;
        s.selectedGuids = guid ? [guid] : [];
      }),

    setHovered: (guid) =>
      set((s) => {
        if (s.hoveredGuid !== guid) s.hoveredGuid = guid;
      }),

    // Additive toggle for the Align tool's multi-selection.
    toggleSelect: (guid) =>
      set((s) => {
        if (!guid) return;
        const i = s.selectedGuids.indexOf(guid);
        if (i >= 0) {
          s.selectedGuids.splice(i, 1);
          s.selectedGuid = s.selectedGuids[s.selectedGuids.length - 1] ?? null;
        } else {
          s.selectedGuids.push(guid);
          s.selectedGuid = guid;
        }
      }),

    // Align every selected component's offset to the chosen reference component on one axis,
    // keeping the other axis. One undo step.
    alignSelected: (axis, refGuid) => {
      const guids = get().selectedGuids;
      if (guids.length < 2 || !guids.includes(refGuid)) return;
      get().mutate((doc) => {
        const rEl = findComponentElement(doc, refGuid);
        if (!rEl) return;
        const [rx, ry] = parseVec2(getAttr(rEl, "offset"), [0, 0]);
        for (const g of guids) {
          if (g === refGuid) continue;
          const el = findComponentElement(doc, g);
          if (!el) continue;
          const [x, y] = parseVec2(getAttr(el, "offset"), [0, 0]);
          setAttr(el, "offset", axis === "x" ? fmtVec2(rx, y) : fmtVec2(x, ry));
        }
      });
    },

    // With exactly three selected, move the chosen middle component to the 2D midpoint of the
    // other two (averages both x and y). One undo step.
    centerBetween: (midGuid) => {
      const guids = get().selectedGuids;
      if (guids.length !== 3 || !guids.includes(midGuid)) return;
      const ends = guids.filter((g) => g !== midGuid);
      get().mutate((doc) => {
        const midEl = findComponentElement(doc, midGuid);
        const aEl = findComponentElement(doc, ends[0]);
        const bEl = findComponentElement(doc, ends[1]);
        if (!midEl || !aEl || !bEl) return;
        const [ax, ay] = parseVec2(getAttr(aEl, "offset"), [0, 0]);
        const [bx, by] = parseVec2(getAttr(bEl, "offset"), [0, 0]);
        setAttr(midEl, "offset", fmtVec2((ax + bx) / 2, (ay + by) / 2));
      });
    },

    // Spread 3+ selected components evenly along one axis: the two extremes (min/max offset on
    // that axis) stay put and the in-between ones are evenly spaced between them. The other axis
    // is kept. One undo step.
    distributeSelected: (axis) => {
      const guids = get().selectedGuids;
      if (guids.length < 3) return;
      get().mutate((doc) => {
        const items: { el: RawElement; x: number; y: number }[] = [];
        for (const g of guids) {
          const el = findComponentElement(doc, g);
          if (!el) continue;
          const [x, y] = parseVec2(getAttr(el, "offset"), [0, 0]);
          items.push({ el, x, y });
        }
        if (items.length < 3) return;
        items.sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
        const n = items.length;
        const lo = axis === "x" ? items[0].x : items[0].y;
        const hi = axis === "x" ? items[n - 1].x : items[n - 1].y;
        for (let i = 1; i < n - 1; i++) {
          const v = lo + ((hi - lo) * i) / (n - 1);
          const it = items[i];
          setAttr(it.el, "offset", axis === "x" ? fmtVec2(v, it.y) : fmtVec2(it.x, v));
        }
      });
    },

    // Shift the offset of every selected component by (dx, dy). One undo step (arrow-key nudge).
    nudgeSelected: (dx, dy) => {
      const guids = get().selectedGuids;
      if (!guids.length) return;
      get().mutate((doc) => {
        for (const g of guids) {
          const el = findComponentElement(doc, g);
          if (!el) continue;
          const [x, y] = parseVec2(getAttr(el, "offset"), [0, 0]);
          setAttr(el, "offset", fmtVec2(x + dx, y + dy));
        }
      });
    },

    // With exactly two selected siblings (same parent), exchange their full position set
    // (offset/docking/dock_offset/component_anchor_point). Raw strings are swapped verbatim
    // (no reformat) so a re-save stays byte-identical. One undo step.
    swapSelectedOffsets: () => {
      const guids = get().selectedGuids;
      const cur = get().doc;
      if (guids.length !== 2 || !cur || !sameHierarchyParent(cur, guids[0], guids[1])) return;
      get().mutate((doc) => {
        const elA = findComponentElement(doc, guids[0]);
        const elB = findComponentElement(doc, guids[1]);
        if (!elA || !elB) return;
        for (const key of ["offset", "docking", "dock_offset", "component_anchor_point"]) {
          const va = getAttr(elA, key);
          const vb = getAttr(elB, key);
          if (vb !== undefined) setAttr(elA, key, vb);
          else removeAttr(elA, key);
          if (va !== undefined) setAttr(elB, key, va);
          else removeAttr(elB, key);
        }
      });
    },

    setStatus: (msg) =>
      set((s) => {
        s.status = msg;
      }),

    setView: (v) =>
      set((s) => {
        s.view = { ...s.view, ...v };
      }),

    mutate: (fn) => {
      const cur = get().doc;
      if (!cur) return;
      const snapshot: TwuiDocument = JSON.parse(JSON.stringify(cur));
      const limit = Math.max(0, get().settings.editor.undoLimit);
      set((s) => {
        if (!s.doc) return;
        s.undoStack.push(snapshot);
        while (s.undoStack.length > limit) s.undoStack.shift();
        s.redoStack = [];
        fn(s.doc);
        setActiveDirty(s, true);
      });
    },

    migrateVersion: (target) => {
      const cur = get().doc;
      if (!cur) return null;
      let result: MigrationResult | null = null;
      get().mutate((doc) => {
        result = migrateLayout(doc, target);
      });
      if (result) {
        const r = result as MigrationResult;
        set((s) => {
          s.status = `Converted layout v${r.from} -> v${r.to} (${r.renamed} renamed, ${r.removed} removed, ${r.elementsRemoved} elements removed)`;
        });
      }
      return result;
    },

    editAttr: (guid, key, value) => {
      get().mutate((doc) => {
        // Target the <components> element (component/state/image), not the
        // hierarchy node that shares a component's GUID.
        const el = findComponentElement(doc, guid);
        if (el) setAttr(el, key, value);
      });
    },

    // Write several attributes of one element in a single undo step. Used by the
    // Inspector to keep linked-GUID pairs (this/uniqueguid, currentstate/defaultstate)
    // in sync — editing the merged field updates every member at once.
    editAttrs: (guid, updates) => {
      get().mutate((doc) => {
        const el = findComponentElement(doc, guid);
        if (!el) return;
        for (const [k, v] of Object.entries(updates)) setAttr(el, k, v);
      });
    },

    // The <LayoutEngine> child has no guid of its own, so it's reached via the
    // component's guid (the Inspector's Layout Engine section edits it).
    editLayoutEngineAttr: (guid, key, value) => {
      get().mutate((doc) => {
        const el = findComponentElement(doc, guid);
        const le = el && getLayoutEngine(el);
        if (le) setAttr(le, key, value);
      });
    },

    addLayoutEngine: (guid) => {
      get().mutate((doc) => {
        const el = findComponentElement(doc, guid);
        if (!el || getLayoutEngine(el)) return;
        el.children.push({ kind: "element", tag: "LayoutEngine", attrs: [["type", "List"]], children: [], self_closing: true });
        el.self_closing = false;
      });
    },

    // Edit a Context* callback's `context_function_id` (a script binding). The
    // index matches cco.callbacks() document order; values are XML-encoded.
    setCallbackFunc: (guid, index, value) => {
      get().mutate((doc) => {
        const el = findComponentElement(doc, guid);
        if (!el) return;
        let i = 0;
        for (const tag of ["callbackwithcontextlist", "callbacks_with_context"]) {
          const list = childByTag(el, tag);
          if (!list) continue;
          for (const cb of elementChildren(list)) {
            if (cb.tag !== "callback_with_context") continue;
            if (i === index) {
              setAttr(cb, "context_function_id", encodeEntities(value));
              return;
            }
            i++;
          }
        }
      });
    },

    // --- Structural CRUD (states / component images / image-metrics / callbacks). Each routes
    //     through mutate(), so they snapshot for undo automatically. New elements are selected
    //     where it helps the user continue editing. ---
    addState: (compGuid) => {
      get().mutate((doc) => {
        addState(doc, compGuid);
      });
    },
    deleteState: (compGuid, index) => {
      get().mutate((doc) => deleteState(doc, compGuid, index));
    },
    addComponentImage: (compGuid) => {
      get().mutate((doc) => {
        addComponentImage(doc, compGuid);
      });
    },
    deleteComponentImage: (compGuid, index) => {
      get().mutate((doc) => deleteComponentImage(doc, compGuid, index));
    },
    addImageMetric: (stateGuid, ciGuid) => {
      get().mutate((doc) => {
        addImageMetric(doc, stateGuid, ciGuid);
      });
    },
    addCallback: (compGuid) => {
      get().mutate((doc) => addCallback(doc, compGuid));
    },
    setCallbackAttr: (compGuid, containerTag, index, key, value) => {
      const v = key === "context_function_id" ? encodeEntities(value) : value;
      get().mutate((doc) => setCallbackAttr(doc, compGuid, containerTag, index, key, v));
    },
    addCallbackProp: (compGuid, containerTag, cbIndex) => {
      get().mutate((doc) => addCallbackProp(doc, compGuid, containerTag, cbIndex));
    },
    setCallbackPropAttr: (compGuid, containerTag, cbIndex, propIndex, key, value) => {
      // Property values can carry expressions with entities (e.g. ContextStateSetterConditional
      // conditions); names are plain identifiers stored verbatim.
      const v = key === "value" ? encodeEntities(value) : value;
      get().mutate((doc) => setCallbackPropAttr(doc, compGuid, containerTag, cbIndex, propIndex, key, v));
    },
    moveCallbackProp: (compGuid, containerTag, cbIndex, propIndex, dir) => {
      get().mutate((doc) => moveCallbackProp(doc, compGuid, containerTag, cbIndex, propIndex, dir));
    },
    removeCallbackProp: (compGuid, containerTag, cbIndex, propIndex) => {
      get().mutate((doc) => removeCallbackProp(doc, compGuid, containerTag, cbIndex, propIndex));
    },
    moveChild: (parentGuid, containerTag, index, dir) => {
      get().mutate((doc) => moveChild(doc, parentGuid, containerTag, index, dir));
    },
    removeChild: (parentGuid, containerTag, index) => {
      get().mutate((doc) => removeChild(doc, parentGuid, containerTag, index));
    },
    editChildAttr: (parentGuid, containerTag, index, key, value) => {
      get().mutate((doc) => editChildAttr(doc, parentGuid, containerTag, index, key, value));
    },

    // Hide/show a component by toggling visible="false" on its <components>
    // element. The visualizer prunes hidden subtrees, so this also hides the
    // node's children. Showing removes the flag rather than writing
    // visible="true", keeping files clean for components that had no attr.
    toggleVisible: (guid) => {
      get().mutate((doc) => {
        const el = findComponentElement(doc, guid);
        if (!el) return;
        const hidden =
          getAttr(el, "visible") === "false" || getAttr(el, "is_visible") === "false";
        if (hidden) {
          removeAttr(el, "visible");
          removeAttr(el, "is_visible");
        } else {
          setAttr(el, "visible", "false");
        }
      });
    },

    // Push one undo snapshot at the start of a drag, then apply offsets live.
    beginDrag: () => {
      const cur = get().doc;
      if (!cur) return;
      const snapshot: TwuiDocument = JSON.parse(JSON.stringify(cur));
      const limit = Math.max(0, get().settings.editor.undoLimit);
      set((s) => {
        s.undoStack.push(snapshot);
        while (s.undoStack.length > limit) s.undoStack.shift();
        s.redoStack = [];
      });
    },

    liveSetOffset: (guid, x, y) =>
      set((s) => {
        if (!s.doc) return;
        const comps = componentsSection(s.doc);
        const el = comps && elementChildren(comps).find((c) => guidOf(c) === guid);
        if (el) setAttr(el, "offset", fmtVec2(x, y));
        setActiveDirty(s, true);
      }),

    deleteSelected: () => {
      const g = get().selectedGuid;
      if (!g) return;
      get().mutate((doc) => deleteNode(doc, g));
      set((s) => {
        s.selectedGuid = null;
      });
    },

    duplicateSelected: () => {
      const g = get().selectedGuid;
      if (!g) return;
      let newGuid: string | undefined;
      get().mutate((doc) => {
        newGuid = duplicateNode(doc, g);
      });
      if (newGuid) set((s) => {
        s.selectedGuid = newGuid!;
      });
    },

    regenGuids: () => {
      if (!get().doc) return;
      get().mutate((doc) => {
        regenAllGuids(doc);
      });
    },

    // Regen just the selected component's own GUID(s) (its this/uniqueguid + its states/images);
    // child components keep theirs. References across the doc stay linked.
    regenComponentGuids: (guid) => {
      if (!get().doc) return;
      get().mutate((doc) => {
        const comp = componentMap(doc).get(guid);
        if (comp) regenGuidSet(doc, componentGuidSet(comp));
      });
    },

    // Regen the component AND every descendant component in its hierarchy subtree.
    regenSubtreeGuids: (guid) => {
      if (!get().doc) return;
      get().mutate((doc) => {
        regenGuidSet(doc, subtreeGuidSet(doc, guid));
      });
    },

    setDockLayout: (json) =>
      set((s) => {
        s.settings.dockLayout = json;
      }),
    setDockedPanels: (ids) =>
      set((s) => {
        s.dockedPanels = ids;
      }),
    setPanelPopped: (id, popped) =>
      set((s) => {
        if (popped) s.poppedPanels[id] = true;
        else delete s.poppedPanels[id];
      }),
    setShowBounds: (v) => set((s) => { s.showBounds = v; }),
    setPreviewEmptyLists: (v) => set((s) => { s.previewEmptyLists = v; }),
    setUiPref: (key, value) => set((s) => { s.uiPrefs[key] = value; }),

    setMode: (m) => set((s) => { s.mode = m; }),
    setRenderResolution: (r) => set((s) => { s.renderResolution = r; }),

    copy: () => {
      const g = get().selectedGuid;
      const doc = get().doc;
      if (!g || !doc) return;
      const clip = extractSubtree(doc, g);
      if (clip) set((s) => { s.clipboard = clip; });
    },

    paste: () => {
      const clip = get().clipboard;
      const doc = get().doc;
      if (!clip || !doc) return;
      // Paste under the selected node, else under the design root.
      const root = hierarchyRoot(doc);
      const parent = get().selectedGuid ?? (root ? guidOf(root) ?? null : null);
      if (!parent) return;
      let newGuid: string | undefined;
      get().mutate((d) => {
        newGuid = pasteSubtree(d, parent, clip);
        // Nudge so the paste doesn't sit exactly on the original / parent origin.
        if (newGuid) {
          const comps = componentsSection(d);
          const el = comps && elementChildren(comps).find((c) => guidOf(c) === newGuid);
          if (el) {
            const [ox, oy] = parseVec2(getAttr(el, "offset"), [0, 0]);
            setAttr(el, "offset", fmtVec2(ox + 16, oy + 16));
          }
        }
      });
      if (newGuid) set((s) => { s.selectedGuid = newGuid!; });
    },

    createAt: (parentGuid, x, y) => {
      const doc = get().doc;
      if (!doc) return;
      const root = hierarchyRoot(doc);
      const parent = parentGuid ?? (root ? guidOf(root) ?? null : null);
      if (!parent) return;
      let newGuid: string | undefined;
      get().mutate((d) => {
        newGuid = addNode(d, parent, "new_component", fmtVec2(x, y));
      });
      if (newGuid) set((s) => { s.selectedGuid = newGuid!; });
    },

    addChild: (parentGuid, tag) => {
      let newGuid: string | undefined;
      get().mutate((doc) => {
        newGuid = addNode(doc, parentGuid, tag);
      });
      if (newGuid) set((s) => {
        s.selectedGuid = newGuid!;
      });
    },

    rename: (guid, newId) => {
      get().mutate((doc) => renameNode(doc, guid, newId));
    },

    move: (guid, newParentGuid, beforeGuid) => {
      get().mutate((doc) => moveNode(doc, guid, newParentGuid, beforeGuid));
    },

    applyComponentRaw: (guid, el) => {
      get().mutate((doc) => replaceComponent(doc, guid, el));
      const newGuid = guidOf(el);
      if (newGuid && newGuid !== guid) set((s) => {
        s.selectedGuid = newGuid;
      });
    },

    applyHierarchyRaw: (guid, el) => {
      get().mutate((doc) => replaceHierarchyNode(doc, guid, el));
      const newGuid = guidOf(el);
      if (newGuid && newGuid !== guid) set((s) => {
        s.selectedGuid = newGuid;
      });
    },

    undo: () =>
      set((s) => {
        const prev = s.undoStack.pop();
        if (!prev || !s.doc) return;
        s.redoStack.push(JSON.parse(JSON.stringify(s.doc)));
        s.doc = prev;
        setActiveDirty(s, true);
      }),

    redo: () =>
      set((s) => {
        const next = s.redoStack.pop();
        if (!next || !s.doc) return;
        s.undoStack.push(JSON.parse(JSON.stringify(s.doc)));
        s.doc = next;
        setActiveDirty(s, true);
      }),
    })),
    {
      name: "twui-settings",
      version: 1,
      // Persist only the prefs subset; `view` only when the user opts to restore it
      // (else pan/zoom would write to localStorage constantly).
      partialize: (s) => ({
        settings: s.settings,
        background: s.background,
        ...(s.settings.visualizer.restoreView ? { view: s.view } : {}),
      }),
      merge: (persisted, current) => mergePersisted(current as AppStore, persisted),
    }
  )
);
