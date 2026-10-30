// Module-level registry letting code outside the Visualizer (e.g. the bug-report menu in the
// toolbar) grab a clean, native-resolution PNG of the current layout. The Visualizer registers
// a closure on mount that renders the scene to an offscreen canvas at the layout's own canvas
// size (no pan/zoom/overlays); it clears the closure on unmount. Kept out of the Zustand store
// so we never put a function into serialized state.

/** Returns a `data:image/png;base64,...` URL of the layout at native resolution, or null. */
export type CaptureFn = () => string | null;

let captureFn: CaptureFn | null = null;

export function setCaptureFn(fn: CaptureFn | null): void {
  captureFn = fn;
}

/** Capture the visualizer at native resolution, or null if no layout is mounted/loaded. */
/** Headless render support: how many images the Visualizer has requested that are still loading. */
export type PendingImagesFn = () => number;

let pendingFn: PendingImagesFn | null = null;

export function setPendingImagesFn(fn: PendingImagesFn | null): void {
  pendingFn = fn;
}

/** Images requested but not yet loaded (or failed); 0 when nothing is pending or no Visualizer is mounted. */
export function pendingImages(): number {
  try {
    return pendingFn ? pendingFn() : 0;
  } catch {
    return 0;
  }
}

export function captureVisualizer(): string | null {
  try {
    return captureFn ? captureFn() : null;
  } catch {
    return null;
  }
}
