// Helpers for decoded binary UIC layouts (root <ui>, pre-3K games).
//
// The Rust codec (src-tauri/src/uic/) decodes binary layouts into an element
// tree: <uientry>/<state>/<image> carry a synthetic `this` GUID (uic-N) plus
// deciphered fields promoted to attributes; undeciphered fields are positional
// typed children (<i v=""/>, <flt v=""/>, <yes/>, ...). The encoder ignores
// `this` and recomputes array counts, so attribute edits and whole-element
// operations round-trip; typed children are editable through the raw XML
// editor and validated at encode time.

import { RawElement, TwuiDocument, isElement } from "../types/twui";
import { elementChildren, getAttr } from "./doc";

/** Tags that are positional typed values, not navigable structure. */
const PRIMITIVE_TAGS = new Set([
  "i",
  "u",
  "u2",
  "byte",
  "flt",
  "s",
  "yes",
  "no",
  "color",
  "data",
]);

export function isUicPrimitive(el: RawElement): boolean {
  return PRIMITIVE_TAGS.has(el.tag);
}

/** The root <uientry> of a decoded UIC document. */
export function uicRoot(doc: TwuiDocument): RawElement | undefined {
  return elementChildren(doc.root).find((c) => c.tag === "uientry");
}

/** The decoded layout's binary version (e.g. 96), 0 when unparseable. */
export function uicVersion(doc: TwuiDocument): number {
  const v = getAttr(doc.root, "version");
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Navigable children of a uic node for the hierarchy tree: descendant elements
 * that carry a `this` GUID (uientry/state/image), flattened through their
 * container tags (children/states/images) without descending into them.
 */
export function uicNavChildren(el: RawElement): RawElement[] {
  const out: RawElement[] = [];
  const visit = (e: RawElement) => {
    for (const c of e.children) {
      if (!isElement(c)) continue;
      if (getAttr(c, "this")) out.push(c);
      else if (!isUicPrimitive(c)) visit(c);
    }
  };
  visit(el);
  return out;
}

/** Display label for a uic tree row. */
export function uicLabel(el: RawElement): string {
  switch (el.tag) {
    case "uientry": {
      const t = getAttr(el, "title");
      return t ? t : "uientry";
    }
    case "state": {
      const t = getAttr(el, "title");
      return t ? `state: ${t}` : "state";
    }
    case "image": {
      const p = getAttr(el, "path") ?? "";
      const base = p.split("/").pop() || p;
      return base ? `image: ${base}` : `image #${getAttr(el, "id") ?? "?"}`;
    }
    default:
      return el.tag;
  }
}
