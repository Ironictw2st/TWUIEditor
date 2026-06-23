// Pop a docked panel out into its own OS window (Tauri multi-window). The new window loads the same
// app with `?panel=<id>`, which boots into single-panel mode (see main.tsx) and mirrors the live
// store via the BroadcastChannel sync (sync.ts). Closing the window redocks the panel.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { PanelId } from "./state/store";

const TITLE: Record<PanelId, string> = {
  hierarchy: "Hierarchy",
  inspector: "Inspector",
  perspective: "Perspective",
  visualizer: "Visualizer",
};
const SIZE: Record<PanelId, { width: number; height: number }> = {
  hierarchy: { width: 360, height: 820 },
  inspector: { width: 430, height: 900 },
  perspective: { width: 560, height: 220 },
  visualizer: { width: 1040, height: 780 },
};

/** Open (or focus) the OS window for a panel. `onClosed` fires when the user closes that window. */
export async function popOutPanel(id: PanelId, onClosed: (id: PanelId) => void): Promise<void> {
  const label = `panel-${id}`;
  try {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    const win = new WebviewWindow(label, {
      url: `index.html?panel=${id}`,
      title: `TWUI — ${TITLE[id]}`,
      width: SIZE[id].width,
      height: SIZE[id].height,
    });
    win.once("tauri://destroyed", () => onClosed(id));
    win.once("tauri://error", (e) => {
      // eslint-disable-next-line no-console
      console.error("pop-out window error", e);
      onClosed(id);
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("pop-out failed", e);
    onClosed(id);
  }
}

/** Close a panel's pop-out window (redock). */
export async function closePanelWindow(id: PanelId): Promise<void> {
  try {
    const win = await WebviewWindow.getByLabel(`panel-${id}`);
    if (win) await win.close();
  } catch {
    /* already gone */
  }
}
