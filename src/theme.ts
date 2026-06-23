// Applies the user's appearance preferences (settings.theme) to the document.
//
// Colours live as CSS variables in src/index.css with a dark default and a
// `[data-theme="light"]` override. This resolver sets `data-theme` / `data-density`
// on <html> and pushes the chosen accent into `--accent`. "system" mode follows the
// OS colour scheme via matchMedia and updates live when it changes.

import type { StoreApi } from "zustand";
import type { AppStore } from "./state/store";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function resolveMode(mode: AppStore["settings"]["theme"]["mode"]): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  const mql = typeof window !== "undefined" && window.matchMedia(LIGHT_QUERY);
  return mql && mql.matches ? "light" : "dark";
}

/** "#c9a227" -> "201 162 39" (space-separated RGB channels for the CSS vars). */
function hexToChannels(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function apply(theme: AppStore["settings"]["theme"]): void {
  const root = document.documentElement;
  root.dataset.theme = resolveMode(theme.mode);
  root.dataset.density = theme.density;
  const accent = hexToChannels(theme.accent);
  if (accent) root.style.setProperty("--accent", accent);
}

/** Wire up theme application: apply now, then re-apply on settings or OS-scheme change. */
export function initTheme(store: StoreApi<AppStore>): void {
  apply(store.getState().settings.theme);

  let prev = store.getState().settings.theme;
  store.subscribe((s) => {
    const t = s.settings.theme;
    if (t !== prev) {
      prev = t;
      apply(t);
    }
  });

  if (typeof window !== "undefined" && window.matchMedia) {
    const mql = window.matchMedia(LIGHT_QUERY);
    const onChange = () => {
      if (store.getState().settings.theme.mode === "system") {
        apply(store.getState().settings.theme);
      }
    };
    mql.addEventListener("change", onChange);
  }
}
