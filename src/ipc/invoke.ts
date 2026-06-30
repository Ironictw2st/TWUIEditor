// Transport shim for backend calls. The desktop build talks to Tauri via the
// native `invoke`; the experimental web access point (a plain browser reaching
// the host over HTTP) POSTs the same command + args to `/api/invoke/{cmd}`.
//
// Every wrapper in `commands.ts` goes through this, so it is the single seam
// that retargets the whole editor between the two transports.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * True when running in a plain browser rather than the Tauri webview. Tauri v2
 * injects `__TAURI_INTERNALS__` on `window` before app scripts run, so its
 * absence means we are the remote web client.
 */
export function isBrowserMode(): boolean {
  return typeof window === "undefined" || typeof (window as any).__TAURI_INTERNALS__ === "undefined";
}

/** Stable capability flag for guarding desktop-only features (pop-out, updater, …). */
export const IS_BROWSER = isBrowserMode();

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!IS_BROWSER) {
    return tauriInvoke<T>(cmd, args);
  }

  const res = await fetch(`/api/invoke/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
    credentials: "same-origin",
  });

  if (res.status === 401) {
    // Session expired or never authenticated: send the user to the login page.
    if (typeof window !== "undefined") window.location.href = "/login";
    return Promise.reject("authentication required");
  }
  if (!res.ok) {
    // Reject with the bare message string, matching Tauri's rejection shape so
    // existing `catch (e) { ... ${e} }` status handling reads correctly.
    const text = await res.text().catch(() => "");
    return Promise.reject(text || `request failed (${res.status})`);
  }
  // Commands return JSON; a unit return serializes as `null`.
  return (await res.json()) as T;
}
