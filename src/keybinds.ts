// Central keyboard-shortcut registry. The single source of truth for every global
// shortcut: App.tsx's keydown handler dispatches through `runMatchingAction`, and the
// Settings screen lists/rebinds these actions. Bindings are normalized strings like
// "Mod+Shift+Z" where `Mod` = Ctrl on Windows/Linux, Cmd on macOS.

import type { AppStore } from "./state/store";

export interface KeyAction {
  id: string;
  label: string;
  category: string;
  /** Canonical default binding (e.g. "Mod+Z", "Delete"). For `kind: "mouse"` this is a bare
   *  modifier ("Shift" | "Alt" | "Mod") combined with a click. */
  defaultBinding: string;
  /** Extra always-on bindings that also trigger the action (not separately rebindable). */
  aliases?: string[];
  /** Whether the shortcut fires while typing in an input/textarea/select. Chorded
   *  actions (with a Mod) default to true; bare keys (Delete) should be false. */
  allowInInput?: boolean;
  /** "key" (default) actions dispatch on keydown via `run`. "mouse" actions are click modifiers
   *  (e.g. Shift+Click) — they have no `run`, are configured with a modifier picker, and are read
   *  directly by the canvas (`mouseModifierHeld`). */
  kind?: "key" | "mouse";
  /** Runs the action. Receives the originating event (for modifier-sensitive actions like nudge).
   *  Returning `false` DECLINES — the key falls through to its default (e.g. arrows still scroll
   *  when nothing is selected). */
  run?: (store: AppStore, e: KeyboardEvent) => void | boolean;
}

/** Nudge the current selection by (sx, sy) * step, where Shift makes the step 10px instead of 1px.
 *  Declines (returns false) when nothing is selected or in a preview mode, so arrows keep their
 *  default behavior then. */
function nudge(s: AppStore, sx: number, sy: number, e: KeyboardEvent): void | boolean {
  if (s.mode === "sim" || s.mode === "tooltip" || !s.selectedGuids.length) return false;
  const step = e.shiftKey ? 10 : 1;
  s.nudgeSelected(sx * step, sy * step);
}

/** Action id for the Shift+Click "add to selection" modifier (read by the visualizer). */
export const MULTI_SELECT = "multi-select";

export const ACTIONS: KeyAction[] = [
  { id: "undo", label: "Undo", category: "Editor", defaultBinding: "Mod+Z", allowInInput: true, run: (s) => s.undo() },
  {
    id: "redo", label: "Redo", category: "Editor", defaultBinding: "Mod+Y",
    aliases: ["Mod+Shift+Z"], allowInInput: true, run: (s) => s.redo(),
  },
  { id: "save", label: "Save", category: "File", defaultBinding: "Mod+S", allowInInput: true, run: (s) => s.save() },
  {
    id: "search", label: "Go to component", category: "Navigation", defaultBinding: "Mod+F",
    allowInInput: true, run: (s) => s.openSearch("find"),
  },
  {
    id: "duplicate", label: "Duplicate node", category: "Editor", defaultBinding: "Mod+D",
    allowInInput: false, run: (s) => { if (s.selectedGuid) s.duplicateSelected(); },
  },
  {
    id: "delete", label: "Delete node", category: "Editor", defaultBinding: "Delete",
    aliases: ["Backspace"], allowInInput: false, run: (s) => { if (s.selectedGuid) s.deleteSelected(); },
  },
  { id: "tool-select", label: "Select tool", category: "Tools", defaultBinding: "V", allowInInput: false, run: (s) => s.setMode("view") },
  { id: "tool-move", label: "Move tool", category: "Tools", defaultBinding: "M", allowInInput: false, run: (s) => s.setMode("move") },
  { id: "tool-create", label: "Create tool", category: "Tools", defaultBinding: "N", allowInInput: false, run: (s) => s.setMode("create") },
  { id: "tool-align", label: "Align tool", category: "Tools", defaultBinding: "A", allowInInput: false, run: (s) => s.setMode("align") },
  { id: "copy", label: "Copy component", category: "Editor", defaultBinding: "Mod+C", allowInInput: false, run: (s) => s.copy() },
  { id: "paste", label: "Paste component", category: "Editor", defaultBinding: "Mod+V", allowInInput: false, run: (s) => s.paste() },
  { id: MULTI_SELECT, label: "Multi-select (add to selection)", category: "Selection", defaultBinding: "Shift", kind: "mouse" },
  { id: "nudge-left", label: "Nudge left", category: "Nudge", defaultBinding: "ArrowLeft", aliases: ["Shift+ArrowLeft"], allowInInput: false, run: (s, e) => nudge(s, -1, 0, e) },
  { id: "nudge-right", label: "Nudge right", category: "Nudge", defaultBinding: "ArrowRight", aliases: ["Shift+ArrowRight"], allowInInput: false, run: (s, e) => nudge(s, 1, 0, e) },
  { id: "nudge-up", label: "Nudge up", category: "Nudge", defaultBinding: "ArrowUp", aliases: ["Shift+ArrowUp"], allowInInput: false, run: (s, e) => nudge(s, 0, -1, e) },
  { id: "nudge-down", label: "Nudge down", category: "Nudge", defaultBinding: "ArrowDown", aliases: ["Shift+ArrowDown"], allowInInput: false, run: (s, e) => nudge(s, 0, 1, e) },
];

const MOD_ORDER = ["Mod", "Shift", "Alt"];

/** A single non-modifier key in canonical form (single chars uppercased). */
function normalizeKey(k: string): string {
  if (!k) return "";
  return k.length === 1 ? k.toUpperCase() : k;
}

/** Canonicalize a binding string (sort modifiers, uppercase the key). */
export function canonBinding(binding: string): string {
  const parts = binding.split("+").map((p) => p.trim()).filter(Boolean);
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  const key = parts.find((p) => !MOD_ORDER.includes(p)) ?? "";
  return [...mods, normalizeKey(key)].filter(Boolean).join("+");
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/** A KeyboardEvent -> canonical binding string ("" for a bare modifier press). */
export function normalizeEvent(e: KeyboardEvent): string {
  if (MODIFIER_KEYS.has(e.key)) return "";
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("Mod");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  return [...mods, normalizeKey(e.key)].filter(Boolean).join("+");
}

/** Does an event match a binding? */
export function matchBinding(e: KeyboardEvent, binding: string): boolean {
  const ev = normalizeEvent(e);
  return ev !== "" && ev === canonBinding(binding);
}

const IS_MAC =
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

/** Display form of a binding (platform-correct, plain text — no emoji). */
export function formatBinding(binding: string): string {
  return canonBinding(binding)
    .split("+")
    .map((p) => (p === "Mod" ? (IS_MAC ? "Cmd" : "Ctrl") : p))
    .join("+");
}

/** The effective binding for an action given the user's overrides. */
export function bindingFor(action: KeyAction, overrides: Record<string, string>): string {
  return overrides[action.id] ?? action.defaultBinding;
}

/** Is the modifier required by a `kind: "mouse"` binding held during this mouse event? */
export function mouseModifierHeld(
  e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  binding: string
): boolean {
  switch (canonBinding(binding)) {
    case "Shift":
      return e.shiftKey;
    case "Alt":
      return e.altKey;
    case "Mod":
      return e.ctrlKey || e.metaKey;
    default:
      return false;
  }
}

/** The configured multi-select click modifier (defaults to Shift). */
export function multiSelectBinding(overrides: Record<string, string>): string {
  return overrides[MULTI_SELECT] ?? "Shift";
}

/** Map of canonical binding -> the action ids that share it (length > 1 = a conflict). */
export function bindingConflicts(overrides: Record<string, string>): Record<string, string[]> {
  const byBinding: Record<string, string[]> = {};
  for (const a of ACTIONS) {
    const key = canonBinding(bindingFor(a, overrides));
    (byBinding[key] ??= []).push(a.id);
  }
  return Object.fromEntries(Object.entries(byBinding).filter(([, ids]) => ids.length > 1));
}

/** Dispatch a keydown through the registry. Returns true if an action ran. */
export function runMatchingAction(
  e: KeyboardEvent,
  overrides: Record<string, string>,
  store: AppStore,
  editing: boolean
): boolean {
  for (const action of ACTIONS) {
    if (action.kind === "mouse" || !action.run) continue; // click modifiers aren't keyboard-dispatched
    const bindings = [bindingFor(action, overrides), ...(action.aliases ?? [])];
    if (!bindings.some((b) => matchBinding(e, b))) continue;
    // A bare-key action must not steal keystrokes while the user is typing.
    if (!action.allowInInput && editing) return false;
    // An action may DECLINE (return false) — e.g. nudge with nothing selected — in which case the
    // key keeps its default behavior (arrow scrolling) and we keep looking.
    const handled = action.run(store, e);
    if (handled === false) continue;
    e.preventDefault();
    return true;
  }
  return false;
}
