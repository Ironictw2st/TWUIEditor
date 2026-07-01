// Helpers for navigating and mutating the raw TWUI document tree.

import { Attr, isElement, RawElement, TwuiDocument, TwuiNode } from "../types/twui";

export function getAttr(el: RawElement, key: string): string | undefined {
  const found = el.attrs.find((a) => a[0] === key);
  return found ? found[1] : undefined;
}

export function setAttr(el: RawElement, key: string, value: string): void {
  const existing = el.attrs.find((a) => a[0] === key);
  if (existing) existing[1] = value;
  else el.attrs.push([key, value] as Attr);
}

export function removeAttr(el: RawElement, key: string): void {
  const i = el.attrs.findIndex((a) => a[0] === key);
  if (i >= 0) el.attrs.splice(i, 1);
}

export function guidOf(el: RawElement): string | undefined {
  return getAttr(el, "this") ?? getAttr(el, "uniqueguid");
}

/** The all-zero GUID (`00000000-0000-0000-0000000000000000`) is the engine's
 *  "unset" sentinel — e.g. a component sets `defaultstate` to it when only a
 *  `currentstate` is meaningful. Reference checks treat it like an absent value.
 *  Also true for empty/missing input. */
export function isNullGuid(g: string | undefined | null): boolean {
  return !g || /^[-0]+$/.test(g);
}

export function elementChildren(el: RawElement): RawElement[] {
  return el.children.filter(isElement);
}

/** Find the first direct child element with the given tag. */
export function childByTag(el: RawElement, tag: string): RawElement | undefined {
  return elementChildren(el).find((c) => c.tag === tag);
}

/** The <layout version="…"> number (0 when absent/unparseable). Behaviour can be
 *  gated on this to avoid regressing older files (see MIN_PARENT_IMAGE_VERSION). */
export function layoutVersion(doc: TwuiDocument): number {
  const v = getAttr(doc.root, "version");
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isNaN(n) ? 0 : n;
}

/** The <hierarchy> section element. */
export function hierarchySection(doc: TwuiDocument): RawElement | undefined {
  return childByTag(doc.root, "hierarchy");
}

/** The <components> section element. */
export function componentsSection(doc: TwuiDocument): RawElement | undefined {
  return childByTag(doc.root, "components");
}

/** The <root> node inside <hierarchy> (top of the visible tree). */
export function hierarchyRoot(doc: TwuiDocument): RawElement | undefined {
  const h = hierarchySection(doc);
  return h ? elementChildren(h)[0] : undefined;
}

/** Map of GUID -> component definition element from the <components> section. */
export function componentMap(doc: TwuiDocument): Map<string, RawElement> {
  const map = new Map<string, RawElement>();
  const comps = componentsSection(doc);
  if (!comps) return map;
  for (const c of elementChildren(comps)) {
    const g = guidOf(c);
    if (g) map.set(g, c);
  }
  return map;
}

/** GUID chain from the hierarchy root down to (excluding) the target node. */
export function ancestorGuids(doc: TwuiDocument, guid: string): string[] {
  const root = hierarchyRoot(doc);
  if (!root) return [];
  let result: string[] = [];
  const dfs = (node: RawElement, chain: string[]): boolean => {
    const g = guidOf(node);
    if (g === guid) {
      result = chain;
      return true;
    }
    const next = g ? [...chain, g] : chain;
    for (const c of elementChildren(node)) {
      if (dfs(c, next)) return true;
    }
    return false;
  };
  dfs(root, []);
  return result;
}

/** Depth-first search a subtree for an element whose `this` == guid. */
export function findByThisIn(root: RawElement, guid: string): RawElement | undefined {
  const stack: TwuiNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (!isElement(n)) continue;
    if (getAttr(n, "this") === guid) return n;
    for (const c of n.children) stack.push(c);
  }
  return undefined;
}

/** Depth-first search the whole tree for an element whose `this` == guid. */
export function findByThis(doc: TwuiDocument, guid: string): RawElement | undefined {
  return findByThisIn(doc.root, guid);
}

/**
 * Resolve a GUID to its element under <components> (component / state / image),
 * NOT the matching <hierarchy> node which shares the component's GUID.
 */
export function findComponentElement(doc: TwuiDocument, guid: string): RawElement | undefined {
  const comps = componentsSection(doc);
  return comps ? findByThisIn(comps, guid) : findByThis(doc, guid);
}

/** The states of a component: children of its <states> element. */
export function componentStates(comp: RawElement): RawElement[] {
  const states = childByTag(comp, "states");
  return states ? elementChildren(states) : [];
}

/** The component_image definitions of a component. */
export function componentImages(comp: RawElement): RawElement[] {
  const imgs = childByTag(comp, "componentimages");
  return imgs ? elementChildren(imgs) : [];
}

/** The <imagemetrics><image> entries of a state (each references a componentimage by guid). */
export function stateImages(state: RawElement): RawElement[] {
  const m = childByTag(state, "imagemetrics");
  return m ? elementChildren(m).filter((e) => e.tag === "image") : [];
}

/** Pick the active state element for rendering: current, else default, else first. */
export function activeState(comp: RawElement): RawElement | undefined {
  const states = componentStates(comp);
  if (states.length === 0) return undefined;
  const cur = getAttr(comp, "currentstate") ?? getAttr(comp, "defaultstate");
  if (cur) {
    const found = states.find((s) => guidOf(s) === cur);
    if (found) return found;
  }
  return states[0];
}

export function getLayoutEngine(comp: RawElement): RawElement | undefined {
  return childByTag(comp, "LayoutEngine");
}

/** Parse "x,y" attribute into a tuple, with a fallback. */
export function parseVec2(s: string | undefined, fallback: [number, number]): [number, number] {
  if (!s) return fallback;
  const parts = s.split(",");
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  return [isNaN(x) ? fallback[0] : x, isNaN(y) ? fallback[1] : y];
}

export function fmtFloat2(n: number): string {
  return n.toFixed(2);
}

export function fmtVec2(x: number, y: number): string {
  return `${fmtFloat2(x)},${fmtFloat2(y)}`;
}
