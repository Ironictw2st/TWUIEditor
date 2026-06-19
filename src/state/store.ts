import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { ContextDb, FactionContext, TwuiDocument } from "../types/twui";
import * as ipc from "../ipc/commands";
import {
  componentsSection,
  elementChildren,
  findComponentElement,
  fmtVec2,
  getAttr,
  guidOf,
  removeAttr,
  setAttr,
} from "../twui/doc";
import { collectTemplateIds } from "../twui/template";
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

interface AppStore {
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

  contextDb: ContextDb | null;
  context: FactionContext;
  templates: Record<string, TwuiDocument>;
  loc: Record<string, string>;
  backgrounds: string[];
  background: string | null;

  init: () => Promise<void>;
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

const MAX_UNDO = 100;

export const useStore = create<AppStore>()(
  immer((set, get) => ({
    doc: null,
    filePath: null,
    fileName: null,
    dirty: false,
    selectedGuid: null,
    dataRoot: null,
    status: "Ready",
    view: { zoom: 0.5, panX: 40, panY: 40 },
    undoStack: [],
    redoStack: [],

    contextDb: null,
    context: {
      campaign: "3k_main_campaign_map",
      faction: "3k_main_faction_cao_cao",
      culture: "3k_main_chinese",
      subculture: "3k_main_chinese",
    },
    templates: {},
    loc: {},
    backgrounds: [],
    background: null,

    setBackground: (path) =>
      set((s) => {
        s.background = path;
      }),

    init: async () => {
      try {
        const root = await ipc.getDataRoot();
        set((s) => {
          s.dataRoot = root;
        });
      } catch (e) {
        set((s) => {
          s.status = `Failed to read data root: ${e}`;
        });
      }
      try {
        const db = await ipc.loadContextDb();
        set((s) => {
          s.contextDb = db;
        });
      } catch (e) {
        set((s) => {
          s.status = `Failed to load DB: ${e}`;
        });
      }
      try {
        const loc = await ipc.loadLoc();
        set((s) => {
          s.loc = loc;
        });
      } catch {
        /* localisation optional */
      }
      try {
        const backgrounds = await ipc.listBackgrounds();
        set((s) => {
          s.backgrounds = backgrounds;
          const def = "background/campaign.png";
          s.background = backgrounds.includes(def) ? def : backgrounds[0] ?? null;
        });
      } catch {
        /* backgrounds optional */
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
          s.status = `Loaded ${baseName(path)}`;
        });
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
      set((s) => {
        if (!s.doc) return;
        s.undoStack.push(snapshot);
        if (s.undoStack.length > MAX_UNDO) s.undoStack.shift();
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
      set((s) => {
        s.undoStack.push(snapshot);
        if (s.undoStack.length > MAX_UNDO) s.undoStack.shift();
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
  }))
);
