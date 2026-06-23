// Cross-window state sync for popped-out panels (separate OS windows).
//
// All windows share one origin, so a same-origin BroadcastChannel mirrors the live store between
// them with no Rust plumbing. The MAIN window is the authoritative LEADER: it broadcasts the data
// slice of the store on every change (throttled to a frame). PANEL windows are FOLLOWERS: they
// render from the mirrored slice and forward every action call to the leader to execute. Only the
// leader posts "state"; only followers post "action"/"hello" -> no echo loops.

import type { StoreApi } from "zustand";
import type { AppStore } from "./state/store";

const CHANNEL = "twui-sync";

// Window-local store fields that must NOT be mirrored: each window pans/zooms independently (view),
// undo history is huge and leader-only, settings persist per-origin already, and pop-out bookkeeping
// is per-window.
const DENY_KEYS = new Set(["view", "undoStack", "redoStack", "settings", "poppedPanels"]);
// Actions a follower runs LOCALLY instead of forwarding (pan/zoom is per-window).
const LOCAL_ACTIONS = new Set(["setView"]);

type Msg =
  | { type: "state"; payload: Record<string, unknown> }
  | { type: "action"; name: string; args: unknown[] }
  | { type: "hello" };

/** The `?panel=<id>` query param identifying a popped-out panel window (null in the main window). */
export function panelParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("panel");
  } catch {
    return null;
  }
}
export function isPanelWindow(): boolean {
  return !!panelParam();
}

/** The mirrored slice: every non-function data field except the window-local denylist. */
export function dataSlice(state: AppStore): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rec = state as unknown as Record<string, unknown>;
  for (const k in rec) {
    if (DENY_KEYS.has(k)) continue;
    if (typeof rec[k] === "function") continue;
    out[k] = rec[k];
  }
  return out;
}

/** Wire up cross-window mirroring. Safe no-op when BroadcastChannel is unavailable. */
export function initSync(store: StoreApi<AppStore>): void {
  if (typeof BroadcastChannel === "undefined") return;
  let chan: BroadcastChannel;
  try {
    chan = new BroadcastChannel(CHANNEL);
  } catch {
    return;
  }

  if (!isPanelWindow()) {
    // LEADER: broadcast the data slice on change (coalesced per animation frame), answer hellos,
    // and run actions forwarded from followers. Broadcasting only starts once a follower exists, so
    // the common single-window case carries zero overhead.
    let queued = false;
    let hasFollowers = false;
    const broadcast = () => {
      queued = false;
      try {
        chan.postMessage({ type: "state", payload: dataSlice(store.getState()) } satisfies Msg);
      } catch {
        /* doc not structured-cloneable should never happen; ignore */
      }
    };
    const schedule = () => {
      if (!hasFollowers || queued) return;
      queued = true;
      requestAnimationFrame(broadcast);
    };
    store.subscribe(schedule);
    chan.onmessage = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      if (m.type === "hello") {
        hasFollowers = true;
        broadcast();
      } else if (m.type === "action") {
        const fn = (store.getState() as unknown as Record<string, unknown>)[m.name];
        if (typeof fn === "function") (fn as (...a: unknown[]) => void)(...m.args);
      }
    };
  } else {
    // FOLLOWER: replace store actions with forwarders, apply mirrored state, request a snapshot.
    const st = store.getState() as unknown as Record<string, unknown>;
    const wrapped: Record<string, unknown> = {};
    for (const k in st) {
      if (typeof st[k] === "function" && !LOCAL_ACTIONS.has(k)) {
        wrapped[k] = (...args: unknown[]) => {
          try {
            chan.postMessage({ type: "action", name: k, args } satisfies Msg);
          } catch {
            /* non-cloneable arg; drop */
          }
        };
      }
    }
    store.setState(wrapped as Partial<AppStore>);
    let synced = false;
    chan.onmessage = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      if (m.type === "state") {
        synced = true;
        store.setState(m.payload as Partial<AppStore>);
      }
    };
    const hello = () => {
      try {
        chan.postMessage({ type: "hello" } satisfies Msg);
      } catch {
        /* ignore */
      }
    };
    hello();
    // Retry once in case the leader's listener wasn't ready when we first asked.
    setTimeout(() => {
      if (!synced) hello();
    }, 300);
  }
}
