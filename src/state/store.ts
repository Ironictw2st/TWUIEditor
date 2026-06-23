import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { CcoDocs, CcoShorthand, CharacterDb, ContextDb, FactionContext, TwuiDocument } from "../types/twui";
import * as ipc from "../ipc/commands";
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
import { collectScriptComponents, pageScriptId } from "../twui/script";
import {
  addNode,
  componentGuidSet,
  deleteNode,
  duplicateNode,
  extractSubtree,
  moveNode,
  pasteSubtree,
  regenAllGuids,
  regenGuidSet,
  renameNode,
  replaceComponent,
  replaceHierarchyNode,
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
export type PanelId = "hierarchy" | "inspector" | "perspective" | "visualizer";
export const PANEL_IDS: PanelId[] = ["hierarchy", "inspector", "perspective", "visualizer"];

/** Persisted user preferences (localStorage `twui-settings`). Document/runtime
 *  state is never persisted — only this subset (+ `background`/`view`). */
export interface Settings {
  /** actionId -> binding override (only set when the user rebinds; else the default). */
  keybinds: Record<string, string>;
  /** Default perspective applied on load (null = the built-in default). */
  perspective: FactionContext | null;
  visualizer: { defaultMode: Mode; showBounds: boolean; restoreView: boolean };
  editor: { undoLimit: number; rememberLastFile: boolean };
  /** Stub for future theming; wired but no visual effect yet. */
  theme: { accent: string; density: "comfortable" | "compact" };
  /** Serialized dockview layout (`api.toJSON()`), restored on load. Pop-out state is session-only. */
  dockLayout: unknown | null;
  lastGame: string | null;
  lastFile: string | null;
}

const DEFAULT_VIEW: View = { zoom: 0.5, panX: 40, panY: 40 };

const DEFAULT_SETTINGS: Settings = {
  keybinds: {},
  perspective: null,
  visualizer: { defaultMode: "view", showBounds: false, restoreView: false },
  editor: { undoLimit: 100, rememberLastFile: false },
  theme: { accent: "#c9a227", density: "comfortable" },
  dockLayout: null,
  lastGame: null,
  lastFile: null,
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
    theme: { ...current.settings.theme, ...(ps.theme ?? {}) },
    dockLayout: ps.dockLayout ?? current.settings.dockLayout,
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

export interface AppStore {
  doc: TwuiDocument | null;
  filePath: string | null;
  fileName: string | null;
  dirty: boolean;
  selectedGuid: string | null;
  /** Multi-selection set (Align tool). The first entry is the alignment anchor; `selectedGuid`
   *  is the active one (for the Inspector). Single-select keeps this in sync as `[guid]`. */
  selectedGuids: string[];
  dataRoot: string | null;
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
  /** Quick-find palette: open state + mode ("find" by query, "refs" to selected guid). */
  searchOpen: boolean;
  searchMode: "find" | "refs";
  backgrounds: string[];
  background: string | null;
  /** Active visualizer tool (left tool palette). */
  mode: Mode;
  /** Whether the visualizer draws component bounds outlines (Perspective panel toggle). */
  showBounds: boolean;
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
  setCharacter: (role: string, templateKey: string | null) => void;
  connectScript: (path: string) => Promise<void>;
  clearScript: () => void;
  setDataPackOverride: (pack: LuaValue | null) => void;
  setScriptDraft: (text: string | null) => void;
  setPreviewState: (guid: string, name: string | null) => void;
  openSearch: (mode?: "find" | "refs") => void;
  closeSearch: () => void;
  setBackground: (path: string | null) => void;
  setCampaign: (key: string) => void;
  setFaction: (key: string) => void;
  setCulture: (key: string) => void;
  setSubculture: (key: string) => void;
  openFile: (path: string) => Promise<void>;
  save: () => Promise<void>;
  saveAs: (path: string) => Promise<void>;
  setDataRoot: (path: string) => Promise<void>;
  select: (guid: string | null) => void;
  toggleSelect: (guid: string | null) => void;
  alignSelected: (axis: "x" | "y", refGuid: string) => void;
  centerBetween: (midGuid: string) => void;
  distributeSelected: (axis: "x" | "y") => void;
  nudgeSelected: (dx: number, dy: number) => void;
  setStatus: (s: string) => void;
  setView: (v: Partial<View>) => void;

  mutate: (fn: (doc: TwuiDocument) => void) => void;
  editAttr: (guid: string, key: string, value: string) => void;
  editLayoutEngineAttr: (guid: string, key: string, value: string) => void;
  addLayoutEngine: (guid: string) => void;
  setCallbackFunc: (guid: string, index: number, value: string) => void;
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
  setMode: (m: Mode) => void;
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

export const useStore = create<AppStore>()(
  persist(
    immer((set, get) => ({
    doc: null,
    filePath: null,
    fileName: null,
    dirty: false,
    selectedGuid: null,
    selectedGuids: [],
    poppedPanels: {},
    dockedPanels: [],
    dataRoot: null,
    status: "Ready",
    view: { ...DEFAULT_VIEW },
    undoStack: [],
    redoStack: [],

    games: [],
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
    searchOpen: false,
    searchMode: "find",
    backgrounds: [],
    background: null,
    mode: DEFAULT_SETTINGS.visualizer.defaultMode,
    showBounds: DEFAULT_SETTINGS.visualizer.showBounds,
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
      try {
        await ipc.setGame(name);
        set((s) => {
          s.game = name;
          s.settings.lastGame = name; // remembered across sessions
        });
        // Reload data for the new game; `false` skips re-applying lastGame (no loop).
        await get().init(false);
      } catch (e) {
        set((s) => {
          s.status = `${e}`;
        });
      }
    },

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
        Promise.all([ipc.listGames(), ipc.currentGame()]).then(
          ([games, game]) => set((s) => { s.games = games; s.game = game; }),
          () => {}
        ),
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
      if (
        applyPrefs &&
        st.settings.lastGame &&
        st.games.includes(st.settings.lastGame) &&
        st.settings.lastGame !== st.game
      ) {
        await get().setGame(st.settings.lastGame); // setGame reloads with applyPrefs=false
      }

      // Reopen the last file on first launch, when opted in and nothing is open yet.
      const cur = get();
      if (applyPrefs && cur.settings.editor.rememberLastFile && cur.settings.lastFile && !cur.doc) {
        void cur.openFile(cur.settings.lastFile);
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

    openFile: async (path) => {
      set((s) => {
        s.status = `Loading ${baseName(path)}…`;
      });
      try {
        const doc = await ipc.readLayout(path);
        set((s) => {
          s.doc = doc;
          s.filePath = path;
          s.fileName = baseName(path);
          s.dirty = false;
          s.selectedGuid = null;
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
          if (s.settings.editor.rememberLastFile) s.settings.lastFile = path;
        });
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
              s.status = `Loaded ${baseName(path)} (${n}/${ids.length} templates)`;
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
      } catch (e) {
        set((s) => {
          s.status = `Error: ${e}`;
        });
      }
    },

    save: async () => {
      const { doc, filePath } = get();
      if (!doc || !filePath) return;
      try {
        await ipc.saveLayout(filePath, doc);
        set((s) => {
          s.dirty = false;
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
          s.fileName = baseName(path);
          s.dirty = false;
          s.status = `Saved ${baseName(path)}`;
        });
      } catch (e) {
        set((s) => {
          s.status = `Save error: ${e}`;
        });
      }
    },

    setDataRoot: async (path) => {
      try {
        await ipc.setDataRoot(path);
        set((s) => {
          s.dataRoot = path;
          s.status = `Data root: ${path}`;
        });
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
        s.dirty = true;
      });
    },

    editAttr: (guid, key, value) => {
      get().mutate((doc) => {
        // Target the <components> element (component/state/image), not the
        // hierarchy node that shares a component's GUID.
        const el = findComponentElement(doc, guid);
        if (el) setAttr(el, key, value);
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
        s.dirty = true;
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

    setMode: (m) => set((s) => { s.mode = m; }),

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
        s.dirty = true;
      }),

    redo: () =>
      set((s) => {
        const next = s.redoStack.pop();
        if (!next || !s.doc) return;
        s.undoStack.push(JSON.parse(JSON.stringify(s.doc)));
        s.doc = next;
        s.dirty = true;
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
