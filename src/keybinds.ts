// Central keyboard-shortcut registry. The single source of truth for every global
// shortcut: App.tsx's keydown handler dispatches through `runMatchingAction`, and the
// Settings screen lists/rebinds these actions. Bindings are normalized strings like
// "Mod+Shift+Z" where `Mod` = Ctrl on Windows/Linux, Cmd on macOS.

import type { AppStore } from "./state/store";

export interface KeyAction {
  id: string;
  label: string;
  category: string;
  /** Canonical default binding (e.g. "Mod+Z", "Delete"). */
  defaultBinding: string;
  /** Extra always-on bindings that also trigger the action (not separately rebindable). */
  aliases?: string[];
  /** Whether the shortcut fires while typing in an input/textarea/select. Chorded
   *  actions (with a Mod) default to true; bare keys (Delete) should be false. */
  allowInInput?: boolean;
  run: (store: AppStore) => void;
}

export const ACTIONS: KeyAction[] = [
  { id: "undo", label: "Undo", category: "Editor", defaultBinding: "Mod+Z", allowInInput: true, run: (s) => s.undo() },
  {
    id: "redo", label: "Redo", category: "Editor", defaultBinding: "Mod+Y",
    aliases: ["Mod+Shift+Z"], allowInInput: true, run: (s) => s.redo(),
  },
  { id: "save", label: "Save", category: "File", defaultBinding: "Mod+S", allowInInput: true, run: (s) => s.save() },
  {
    id: "duplicate", label: "Duplicate node", category: "Editor", defaultBinding: "Mod+D",
    allowInInput: false, run: (s) => { if (s.selectedGuid) s.duplicateSelected(); },
  },
  {
    id: "delete", label: "Delete node", category: "Editor", defaultBinding: "Delete",
    aliases: ["Backspace"], allowInInput: false, run: (s) => { if (s.selectedGuid) s.deleteSelected(); },
  },
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
    const bindings = [bindingFor(action, overrides), ...(action.aliases ?? [])];
    if (!bindings.some((b) => matchBinding(e, b))) continue;
    // A bare-key action must not steal keystrokes while the user is typing.
    if (!action.allowInInput && editing) return false;
    e.preventDefault();
    action.run(store);
    return true;
  }
  return false;
}
