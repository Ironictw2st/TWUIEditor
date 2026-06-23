import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  notes: string;
  update: Update;
}

/** Check the configured GitHub endpoint for a newer signed release. Returns null when up to date,
 *  in dev, or on any error (offline / no release / no updater config) — the caller stays quiet. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (update && update.available) {
      return { version: update.version, notes: update.body ?? "", update };
    }
    return null;
  } catch {
    return null;
  }
}

/** Download + install the update (reporting progress 0..1), then relaunch into the new version. */
export async function installAndRelaunch(update: Update, onProgress?: (fraction: number) => void): Promise<void> {
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(1, downloaded / total));
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
  await relaunch();
}
