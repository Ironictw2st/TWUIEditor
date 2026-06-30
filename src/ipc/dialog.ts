// File-picker abstraction. The desktop build uses native OS dialogs
// (@tauri-apps/plugin-dialog); the web client has no native dialog, so it picks
// paths ON THE HOST through the <HostFileBrowser> modal (driven by the small
// external store at the bottom of this file). Every dialog call site imports
// from here so the two transports stay behind one seam.

import { useSyncExternalStore } from "react";
import { open as nativeOpen, save as nativeSave } from "@tauri-apps/plugin-dialog";
import { IS_BROWSER } from "./invoke";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenOptions {
  filters?: FileFilter[];
  defaultPath?: string | null;
  title?: string;
}

export interface SaveOptions {
  filters?: FileFilter[];
  /** Starting directory (or a full path hint in desktop mode). */
  defaultPath?: string | null;
  /** Suggested file name to prefill. */
  defaultFileName?: string;
  title?: string;
}

/** Pick a single existing file. Returns its path, or null if cancelled. */
export async function pickOpenFile(opts: OpenOptions = {}): Promise<string | null> {
  if (IS_BROWSER) {
    return (await requestHostDialog({ kind: "file", ...opts })) as string | null;
  }
  const r = await nativeOpen({
    multiple: false,
    filters: opts.filters,
    defaultPath: opts.defaultPath ?? undefined,
    title: opts.title,
  });
  return typeof r === "string" ? r : null;
}

/** Pick one or more existing files. Returns paths, or null if cancelled. */
export async function pickOpenFiles(opts: OpenOptions = {}): Promise<string[] | null> {
  if (IS_BROWSER) {
    return (await requestHostDialog({ kind: "files", ...opts })) as string[] | null;
  }
  const r = await nativeOpen({
    multiple: true,
    filters: opts.filters,
    defaultPath: opts.defaultPath ?? undefined,
    title: opts.title,
  });
  if (Array.isArray(r)) return r;
  return typeof r === "string" ? [r] : null;
}

/** Pick a directory. Returns its path, or null if cancelled. */
export async function pickOpenDirectory(opts: OpenOptions = {}): Promise<string | null> {
  if (IS_BROWSER) {
    return (await requestHostDialog({ kind: "directory", ...opts })) as string | null;
  }
  const r = await nativeOpen({
    directory: true,
    defaultPath: opts.defaultPath ?? undefined,
    title: opts.title,
  });
  return typeof r === "string" ? r : null;
}

/** Pick a save target. Returns the chosen path, or null if cancelled. */
export async function pickSaveFile(opts: SaveOptions = {}): Promise<string | null> {
  if (IS_BROWSER) {
    return (await requestHostDialog({ kind: "save", ...opts })) as string | null;
  }
  // Combine a starting dir + suggested name into a single hint for the OS dialog.
  let defaultPath = opts.defaultPath ?? undefined;
  if (opts.defaultFileName) {
    defaultPath = defaultPath ? joinHostPath(defaultPath, opts.defaultFileName) : opts.defaultFileName;
  }
  const r = await nativeSave({ filters: opts.filters, defaultPath, title: opts.title });
  return r ?? null;
}

/** Join a directory and a leaf using the separator the directory already uses. */
export function joinHostPath(dir: string, leaf: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("\\") || dir.endsWith("/") ? `${dir}${leaf}` : `${dir}${sep}${leaf}`;
}

// --- Host dialog external store (browser mode only) ------------------------

export type HostDialogKind = "file" | "files" | "directory" | "save";

export interface HostDialogRequest {
  kind: HostDialogKind;
  filters?: FileFilter[];
  defaultPath?: string | null;
  defaultFileName?: string;
  title?: string;
}

type HostDialogResult = string | string[] | null;

let activeRequest: HostDialogRequest | null = null;
let activeResolve: ((r: HostDialogResult) => void) | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function requestHostDialog(req: HostDialogRequest): Promise<HostDialogResult> {
  // Only one picker at a time: cancel any in-flight request first.
  if (activeResolve) activeResolve(null);
  activeRequest = req;
  return new Promise<HostDialogResult>((resolve) => {
    activeResolve = resolve;
    notify();
  });
}

/** Called by <HostFileBrowser> to finish the active request. */
export function resolveHostDialog(result: HostDialogResult) {
  const resolve = activeResolve;
  activeRequest = null;
  activeResolve = null;
  notify();
  resolve?.(result);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function snapshot(): HostDialogRequest | null {
  return activeRequest;
}

/** Subscribe a React component to the current host-dialog request (or null). */
export function useHostDialogRequest(): HostDialogRequest | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
