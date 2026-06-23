import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Portable self-update: the Rust side (src-tauri/src/update.rs) checks the latest GitHub
// release, downloads the portable exe, swaps the running binary in place, and relaunches.

export interface UpdateInfo {
  version: string;
  notes: string;
  /** Direct download URL for the portable exe asset (from check_update). */
  assetUrl: string;
}

/** Check for a newer release. Returns null when up to date, in dev, or on any error
 *  (offline / no release) — the caller stays quiet. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    return await invoke<UpdateInfo | null>("check_update");
  } catch {
    return null;
  }
}

/** Verbose check for the manual "Check for updates" button — distinguishes up-to-date from
 *  a failed check (offline / dev / no release). */
export type CheckResult =
  | { status: "available"; info: UpdateInfo }
  | { status: "current" }
  | { status: "error"; message: string };

export async function checkForUpdateVerbose(): Promise<CheckResult> {
  try {
    const info = await invoke<UpdateInfo | null>("check_update");
    return info ? { status: "available", info } : { status: "current" };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

/** Download the new exe (reporting progress 0..1 via the `update-progress` event), replace the
 *  running binary in place, and relaunch. The app restarts on success, so this normally does not
 *  resolve. */
export async function installAndRelaunch(info: UpdateInfo, onProgress?: (fraction: number) => void): Promise<void> {
  const unlisten = await listen<number>("update-progress", (e) => onProgress?.(e.payload));
  try {
    await invoke("install_update", { assetUrl: info.assetUrl });
  } finally {
    unlisten();
  }
}
