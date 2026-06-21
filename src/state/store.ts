import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { CcoDocs, CcoShorthand, CharacterDb, ContextDb, FactionContext, TwuiDocument } from "../types/twui";
import * as ipc from "../ipc/commands";
import {
  childByTag,
  componentsSection,
  elementChildren,
  findComponentElement,
  fmtVec2,
  getAttr,
  guidOf,
  removeAttr,
  setAttr,
} from "../twui/doc";
import { encodeEntities } from "../twui/cco";
import { LuaValue } from "../twui/lua";
import { collectTemplateIds } from "../twui/template";
import { collectCreatorPaths } from "../twui/creator";
import { pageScriptId } from "../twui/script";
import {
  addNode,
  deleteNode,
  duplicateNode,
  moveNode,
  renameNode,
  replaceComponent,
  replaceHierarchyNode,
} from "../twui/mutate";
import { RawElement } from "../types/twui";

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** Visualizer interaction mode (shared with VisualizerPanel + the keybind registry). */
export type Mode = "view" | "move" | "sim" | "tooltip";

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
    keybinds: { ...(ps.keybinds ?? {}) },
    perspective: ps.perspective ?? null,
  };
  return {
    ...current,
    settings,
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
  /** Raw-Lua working copy for the Script menu's Raw tab (null = use scriptConn.text). */
  scriptDraft: string | null;
  /** Non-persistent per-component state preview (Inspector → Visualizer). */
  previewState: Record<string, string>;
  backgrounds: string[];
  background: string | null;
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
  setStatus: (s: string) => void;
  setView: (v: Partial<View>) => void;

  mutate: (fn: (doc: TwuiDocument) => void) => void;
  editAttr: (guid: string, key: string, value: string) => void;
  setCallbackFunc: (guid: string, index: number, value: string) => void;
  toggleVisible: (guid: string) => void;
  beginDrag: () => void;
  liveSetOffset: (guid: string, x: number, y: number) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
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
    dataRoot: null,
    status: "Ready",
    view: { ...DEFAULT_VIEW },
    undoStack: [],
    redoStack: [],

    games: [],
    game: null,
    contextDb: null,
    context: {
      campaign: "3k_main_campaign_map",
      faction: "3k_main_faction_cao_cao",
      culture: "3k_main_chinese",
      subculture: "3k_main_chinese",
    },
    characterDb: null,
    ccoDocs: null,
    ccoShorthand: null,
    characters: {},
    templates: {},
    createdLayouts: {},
    loc: {},
    scriptConn: { id: null, path: null, text: null, status: "none" },
    dataPackOverride: null,
    scriptDraft: null,
    previewState: {},
    backgrounds: [],
    background: null,
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
            const def = "background/campaign.png";
            s.background = backgrounds.includes(def) ? def : backgrounds[0] ?? null;
          }
        }),
      ]);

      // Apply persisted preferences (after the loads above so games/db are known).
      const st = get();
      if (st.settings.perspective) {
        set((s) => { s.context = { ...st.settings.perspective! }; });
      }
      if (!st.settings.visualizer.restoreView) {
        set((s) => { s.view = { ...DEFAULT_VIEW }; });
      }
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
          // Current faction isn't valid here; prefer Cao Cao, else the first one.
          const next = factions.includes("3k_main_faction_cao_cao")
            ? "3k_main_faction_cao_cao"
            : factions[0];
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
      }),

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
