// Caret-aware tokenizing for the expression autocomplete: given a field's text and the
// caret offset, work out the ref-chain and in-progress prefix under the caret, and where
// to anchor the suggestion popover. Pure string logic (quote/paren-aware) + one DOM helper.

export interface CaretChain {
  /** The ref chain before the active `.` (empty at root position). */
  chain: string;
  /** The identifier fragment being typed after the last `.` (or at root). */
  prefix: string;
  /** Start/end offsets of `prefix` in the text (the accept span to replace). */
  start: number;
  end: number;
  /** True when typing a bare root token (no preceding `.`). */
  atRoot: boolean;
}

const IDENT = /[A-Za-z0-9_]/;
const BOUNDARY = new Set([" ", "\t", "\n", "&", "|", "=", "!", "<", ">", "+", ",", "{", "}", "[", ";", ":"]);

/** True if the caret sits inside an unterminated string literal. */
function inString(text: string, caret: number): boolean {
  let inStr = false;
  let q = "";
  for (let k = 0; k < caret; k++) {
    const c = text[k];
    if (inStr) {
      if (c === q) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      q = c;
    }
  }
  return inStr;
}

/** Walk left from the char before the member dot to the start of the balanced ref chain. */
function chainStart(text: string, dotIdx: number): number {
  let depth = 0;
  let k = dotIdx - 1;
  for (; k >= 0; k--) {
    const c = text[k];
    if (c === ")" || c === "]") {
      depth++;
    } else if (c === "(" || c === "[") {
      if (depth === 0) break; // enclosing opener → chain ends here
      depth--;
    } else if (depth === 0) {
      if (c === '"' || c === "'") break; // depth-0 quote is a boundary
      if (!IDENT.test(c) && c !== ".") break;
    }
    // depth > 0 → inside call args, include everything
  }
  return k + 1;
}

/**
 * Determine the autocomplete context at `caret`. Returns null when the caret is inside a
 * string literal (so no popover fires inside quoted guids/keys).
 */
export function caretChain(text: string, caret: number): CaretChain | null {
  if (inString(text, caret)) return null;
  // Identifier fragment immediately left of the caret.
  let start = caret;
  while (start > 0 && IDENT.test(text[start - 1])) start--;
  const prefix = text.slice(start, caret);

  if (text[start - 1] === ".") {
    const dotIdx = start - 1;
    const cs = chainStart(text, dotIdx);
    return { chain: text.slice(cs, dotIdx).trim(), prefix, start, end: caret, atRoot: false };
  }
  // Root position — only offer completions when actually typing an identifier or on demand.
  if (start === caret && (start === 0 || BOUNDARY.has(text[start - 1]) || text[start - 1] === "(")) {
    return { chain: "", prefix: "", start, end: caret, atRoot: true };
  }
  if (prefix) return { chain: "", prefix, start, end: caret, atRoot: true };
  return null;
}

/** Copied style properties for the caret-measuring mirror element. */
const MIRROR_PROPS = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily",
  "lineHeight", "letterSpacing", "textTransform", "wordSpacing", "whiteSpace", "wordWrap", "tabSize",
] as const;

/**
 * Viewport coordinates of the caret at `pos` in a text field, for anchoring the popover.
 * Uses a hidden mirror element; falls back to the field's bottom-left on any failure.
 */
export function caretCoordinates(
  el: HTMLTextAreaElement | HTMLInputElement,
  pos: number
): { top: number; left: number; height: number } {
  const rect = el.getBoundingClientRect();
  const fallback = { top: rect.bottom, left: rect.left, height: rect.height };
  try {
    const cs = window.getComputedStyle(el);
    const mirror = document.createElement("div");
    const s = mirror.style;
    s.position = "absolute";
    s.visibility = "hidden";
    s.whiteSpace = el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
    s.overflow = "hidden";
    for (const p of MIRROR_PROPS) s[p as any] = cs[p as any];
    mirror.textContent = el.value.slice(0, pos);
    const marker = document.createElement("span");
    marker.textContent = el.value.slice(pos) || ".";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const top = rect.top + (marker.offsetTop - el.scrollTop) + marker.offsetHeight;
    const left = rect.left + (marker.offsetLeft - el.scrollLeft);
    const height = marker.offsetHeight;
    document.body.removeChild(mirror);
    if (!isFinite(top) || !isFinite(left)) return fallback;
    return { top, left, height };
  } catch {
    return fallback;
  }
}
