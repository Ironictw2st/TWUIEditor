// Structural mutations over the raw TWUI document. All functions mutate in
// place (intended to run inside an immer producer). They keep the <hierarchy>
// tree and the <components> section consistent.

import { isElement, RawElement, TwuiDocument, TwuiNode } from "../types/twui";
import {
  childByTag,
  componentsSection,
  elementChildren,
  findComponentElement,
  getAttr,
  guidOf,
  hierarchyRoot,
  hierarchySection,
  removeAttr,
  setAttr,
} from "./doc";

export function genGuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 32)}`;
}

/** A GUID-shaped token: hex groups joined by hyphens, optionally wrapped in braces. */
const GUID_RE = /^\{?[0-9A-Fa-f]+(?:-[0-9A-Fa-f]+)+\}?$/;

/** `n` random hex chars in the requested case. */
function randomHex(n: number, upper: boolean): string {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  return upper ? hex.toUpperCase() : hex.toLowerCase();
}

/**
 * Generate a fresh GUID with the SAME shape as `old`: same brace wrapping, same number of
 * hyphen-separated groups, same per-group length, and same hex case (all-digit groups default
 * to upper = the TWUI standard). Keeps non-standard formats (standard UUID 8-4-4-4-12,
 * lowercase, braced) intact instead of forcing the standard 8-4-4-16 shape.
 */
export function regenGuidLike(old: string): string {
  const braced = old.startsWith("{") && old.endsWith("}");
  const inner = braced ? old.slice(1, -1) : old;
  // Case convention taken from the whole GUID: lowercase only when it has lowercase hex
  // letters and no uppercase ones (so all-digit groups inherit the GUID's case rather than
  // defaulting to the TWUI standard upper).
  const upper = /[A-F]/.test(inner) || !/[a-f]/.test(inner);
  const out = inner
    .split("-")
    .map((g) => randomHex(g.length, upper))
    .join("-");
  return braced ? `{${out}}` : out;
}

/**
 * Replace every GUID in the document with a fresh one of the same format, keeping all internal
 * references consistent. Defining GUIDs (`this`/`uniqueguid`) seed a remap; any attribute value
 * that exactly matches a defining GUID is then rewritten (covers currentstate, defaultstate,
 * componentimage, maskimage, trigger_component, transition_m_target_state, GUID-valued
 * properties, ...). GUIDs not defined in this file (external references) are left untouched.
 * Returns the number of distinct GUIDs regenerated.
 */
export function regenAllGuids(doc: TwuiDocument): number {
  const defining = new Set<string>();
  walk(doc.root, (e) => {
    for (const name of ["this", "uniqueguid"]) {
      const g = getAttr(e, name);
      if (g) defining.add(g);
    }
  });
  return regenGuidSet(doc, defining);
}

/**
 * Regenerate a specific SET of defining GUIDs (format-preserving) and rewrite every attribute in
 * the document that references them, so internal links stay consistent. Non-GUID-shaped entries
 * are ignored. Returns the number of distinct GUIDs regenerated. This is the shared core of the
 * all / single-component / subtree regen actions.
 */
export function regenGuidSet(doc: TwuiDocument, defining: Set<string>): number {
  const remap = new Map<string, string>();
  for (const g of defining) if (GUID_RE.test(g) && !remap.has(g)) remap.set(g, regenGuidLike(g));
  walk(doc.root, (e) => {
    for (const a of e.attrs) {
      const mapped = remap.get(a[1]);
      if (mapped) a[1] = mapped;
    }
  });
  return remap.size;
}

/** Defining GUIDs that BELONG to one component: its own `this`/`uniqueguid` plus those of its
 *  states/images (which live inside the component's definition element). Child components are flat
 *  in `<components>`, so they are NOT included. */
export function componentGuidSet(compEl: RawElement): Set<string> {
  const set = new Set<string>();
  walk(compEl, (e) => {
    for (const name of ["this", "uniqueguid"]) {
      const g = getAttr(e, name);
      if (g) set.add(g);
    }
  });
  return set;
}

/** Defining GUIDs for a component AND every descendant component (its whole hierarchy subtree):
 *  each subtree node's `this` is a component guid; union each of those components' `componentGuidSet`. */
export function subtreeGuidSet(doc: TwuiDocument, rootGuid: string): Set<string> {
  const set = new Set<string>();
  const loc = locateHier(doc, rootGuid);
  if (!loc) return set;
  const compGuids = new Set<string>();
  walk(loc.node, (e) => {
    const g = getAttr(e, "this");
    if (g) compGuids.add(g);
  });
  const comps = componentsSection(doc);
  if (comps) {
    for (const c of elementChildren(comps)) {
      const g = guidOf(c);
      if (g && compGuids.has(g)) for (const guid of componentGuidSet(c)) set.add(guid);
    }
  }
  for (const g of compGuids) set.add(g); // include any hierarchy-only node guids too
  return set;
}

function walk(el: RawElement, fn: (e: RawElement) => void) {
  fn(el);
  for (const c of el.children) if (isElement(c)) walk(c, fn);
}

/** Find a hierarchy node by guid plus its parent and index. */
export interface HierLoc {
  node: RawElement;
  parent: RawElement | null;
  index: number;
}

export function locateHier(doc: TwuiDocument, guid: string): HierLoc | undefined {
  const root = hierarchyRoot(doc);
  if (!root) return undefined;
  if (guidOf(root) === guid) return { node: root, parent: null, index: -1 };

  let result: HierLoc | undefined;
  const recurse = (parent: RawElement) => {
    const kids = elementChildren(parent);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (guidOf(k) === guid) {
        result = { node: k, parent, index: parent.children.indexOf(k) };
        return;
      }
      recurse(k);
      if (result) return;
    }
  };
  recurse(root);
  return result;
}

/** True when two distinct guids are direct siblings (share the same hierarchy parent). */
export function sameHierarchyParent(doc: TwuiDocument, a: string, b: string): boolean {
  if (a === b) return false;
  const la = locateHier(doc, a);
  const lb = locateHier(doc, b);
  return !!la && !!lb && la.parent !== null && la.parent === lb.parent;
}

/** All GUIDs referenced as `this` within a hierarchy subtree. */
function subtreeGuids(node: RawElement): string[] {
  const out: string[] = [];
  walk(node, (e) => {
    const g = getAttr(e, "this");
    if (g) out.push(g);
  });
  return out;
}

function componentByGuid(doc: TwuiDocument, guid: string): RawElement | undefined {
  const comps = componentsSection(doc);
  if (!comps) return undefined;
  return elementChildren(comps).find((c) => guidOf(c) === guid);
}

/** Remove a hierarchy node (and subtree) plus all its component definitions. */
export function deleteNode(doc: TwuiDocument, guid: string): void {
  const loc = locateHier(doc, guid);
  if (!loc || !loc.parent) return; // never delete the root
  const guids = new Set(subtreeGuids(loc.node));
  // Remove from hierarchy.
  const idx = loc.parent.children.indexOf(loc.node);
  if (idx >= 0) loc.parent.children.splice(idx, 1);
  // Remove matching components.
  const comps = componentsSection(doc);
  if (comps) {
    comps.children = comps.children.filter((c) => !(isElement(c) && guids.has(guidOf(c) ?? "")));
  }
}

/** Move a hierarchy node under newParent at the given index among element children. */
export function moveNode(
  doc: TwuiDocument,
  guid: string,
  newParentGuid: string,
  beforeGuid: string | null
): void {
  const loc = locateHier(doc, guid);
  if (!loc || !loc.parent) return;
  const target = locateHier(doc, newParentGuid);
  if (!target) return;
  // Prevent moving a node into its own subtree.
  if (subtreeGuids(loc.node).includes(newParentGuid)) return;

  const node = loc.node;
  const fromIdx = loc.parent.children.indexOf(node);
  loc.parent.children.splice(fromIdx, 1);

  const newParent = target.node;
  let insertAt = newParent.children.length;
  if (beforeGuid) {
    const before = newParent.children.findIndex((c) => isElement(c) && guidOf(c) === beforeGuid);
    if (before >= 0) insertAt = before;
  }
  newParent.children.splice(insertAt, 0, node);
  newParent.self_closing = false; // a node with children can't be self-closing.
}

/** Deep-clone a node JSON-style. */
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** A copied component subtree: a hierarchy node plus its component definitions (deep-cloned and
 *  detached from any document), suitable for the clipboard. */
export interface SubtreeClip {
  hierarchy: RawElement;
  components: RawElement[];
}

/** Deep-clone a hierarchy subtree + its component definitions with FRESH GUIDs, remapping every
 *  internal reference (`this`/`uniqueguid` and any attribute that points at one). The clones are
 *  detached (not inserted). Shared by duplicate and paste. */
function cloneSubtreeWithRemap(
  hierNode: RawElement,
  comps: RawElement[]
): { newHier: RawElement; newComps: RawElement[]; newRootGuid: string | undefined } {
  const rootGuid = getAttr(hierNode, "this");
  const remap = new Map<string, string>();
  const define = (g?: string) => {
    if (g && !remap.has(g)) remap.set(g, genGuid());
  };
  walk(hierNode, (e) => define(getAttr(e, "this")));
  for (const c of comps) {
    walk(c, (e) => {
      define(getAttr(e, "this"));
      define(getAttr(e, "uniqueguid"));
    });
  }
  const remapAttrs = (el: RawElement) => {
    walk(el, (e) => {
      for (const a of e.attrs) {
        const mapped = remap.get(a[1]);
        if (mapped) a[1] = mapped;
      }
    });
  };
  const newHier = clone(hierNode);
  remapAttrs(newHier);
  const newComps = comps.map((c) => {
    const nc = clone(c);
    remapAttrs(nc);
    return nc;
  });
  return { newHier, newComps, newRootGuid: rootGuid ? remap.get(rootGuid) : undefined };
}

/** Duplicate a hierarchy node + its components with fresh GUIDs, inserted as a sibling. */
export function duplicateNode(doc: TwuiDocument, guid: string): string | undefined {
  const loc = locateHier(doc, guid);
  if (!loc || !loc.parent) return undefined;

  const comps = subtreeGuids(loc.node)
    .map((g) => componentByGuid(doc, g))
    .filter((c): c is RawElement => !!c);
  const { newHier, newComps, newRootGuid } = cloneSubtreeWithRemap(loc.node, comps);

  const at = loc.parent.children.indexOf(loc.node);
  loc.parent.children.splice(at + 1, 0, newHier);
  const compsSection = componentsSection(doc);
  if (compsSection) compsSection.children.push(...newComps);

  return newRootGuid;
}

/** Snapshot a hierarchy subtree + its component definitions (deep-cloned) for the clipboard. */
export function extractSubtree(doc: TwuiDocument, guid: string): SubtreeClip | undefined {
  const loc = locateHier(doc, guid);
  if (!loc) return undefined;
  const comps = subtreeGuids(loc.node)
    .map((g) => componentByGuid(doc, g))
    .filter((c): c is RawElement => !!c);
  return { hierarchy: clone(loc.node), components: comps.map(clone) };
}

/** Paste a clipboard subtree as a child of `parentGuid` with fresh GUIDs. Returns the new root
 *  guid. The clip is re-cloned each time, so the clipboard stays reusable. */
export function pasteSubtree(
  doc: TwuiDocument,
  parentGuid: string,
  clip: SubtreeClip
): string | undefined {
  const target = locateHier(doc, parentGuid);
  if (!target) return undefined;
  const { newHier, newComps, newRootGuid } = cloneSubtreeWithRemap(clip.hierarchy, clip.components);
  target.node.children.push(newHier);
  target.node.self_closing = false;
  const compsSection = componentsSection(doc);
  if (compsSection) compsSection.children.push(...newComps);
  return newRootGuid;
}

/** Add a new child component under the given parent hierarchy node. `offset` (a "x,y" string)
 *  sets its position; defaults to the parent origin. */
export function addNode(
  doc: TwuiDocument,
  parentGuid: string,
  tag: string,
  offset = "0.00,0.00"
): string | undefined {
  const target = locateHier(doc, parentGuid);
  if (!target) return undefined;

  const compGuid = genGuid();
  const stateGuid = genGuid();

  // Hierarchy node (leaf).
  const hierNode: RawElement = {
    kind: "element",
    tag,
    attrs: [["this", compGuid]],
    children: [],
    self_closing: true,
  };
  target.node.children.push(hierNode);
  target.node.self_closing = false;

  // Component definition with one default state.
  const state: RawElement = {
    kind: "element",
    tag: "newstate",
    attrs: [
      ["this", stateGuid],
      ["name", "NewState"],
      ["width", "100"],
      ["height", "40"],
      ["interactive", "true"],
      ["uniqueguid", stateGuid],
    ],
    children: [],
    self_closing: true,
  };
  const statesEl: RawElement = {
    kind: "element",
    tag: "states",
    attrs: [],
    children: [state],
    self_closing: false,
  };
  const comp: RawElement = {
    kind: "element",
    tag,
    attrs: [
      ["this", compGuid],
      ["id", tag],
      ["offset", offset],
      ["priority", "100"],
      ["uniqueguid", compGuid],
      ["currentstate", stateGuid],
      ["defaultstate", stateGuid],
    ],
    children: [statesEl],
    self_closing: false,
  };
  const compsSection = componentsSection(doc);
  if (compsSection) compsSection.children.push(comp);

  return compGuid;
}

/** Replace a component definition (matched by guid) with a parsed element. */
export function replaceComponent(doc: TwuiDocument, guid: string, el: RawElement): void {
  const comps = componentsSection(doc);
  if (!comps) return;
  const idx = comps.children.findIndex(
    (c) => isElement(c) && guidOf(c) === guid
  );
  if (idx >= 0) comps.children[idx] = el;
}

/** Replace a hierarchy node (matched by guid) with a parsed element. */
export function replaceHierarchyNode(doc: TwuiDocument, guid: string, el: RawElement): void {
  const loc = locateHier(doc, guid);
  if (!loc) return;
  if (!loc.parent) {
    // Replacing the hierarchy root: swap it inside <hierarchy>.
    const h = loc.node;
    const hierParent = hierarchySection(doc);
    if (!hierParent) return;
    const i = hierParent.children.indexOf(h);
    if (i >= 0) hierParent.children[i] = el;
    return;
  }
  const i = loc.parent.children.indexOf(loc.node);
  if (i >= 0) loc.parent.children[i] = el;
}

/** A token usable as an XML element name (so renaming the tag can't emit `<bad tag>`). */
function isValidTagName(s: string): boolean {
  return /^[A-Za-z_][\w.\-]*$/.test(s);
}

/** A valid XML element name for a component id, or null if one can't be derived. An already-valid
 *  id is used as-is; an id that's only invalid because it starts with a digit (XML tags can't) gets
 *  a leading `_`, so `id="3k_panel"` yields the tag `_3k_panel`; anything else still invalid (e.g.
 *  containing a space) yields null. */
function tagNameForId(id: string): string | null {
  if (!id) return null;
  if (isValidTagName(id)) return id;
  if (isValidTagName("_" + id)) return "_" + id;
  return null;
}

/** Rename a node: the `id` attribute is always set verbatim (the user's value, kept original). The
 *  hierarchy node tag and component definition tag are set to a valid element name derived from the
 *  id — equal to the id when it's already valid, or `_`-prefixed when the id starts with a digit so
 *  `<_id>…</_id>` stays valid XML. An id that can't yield a valid tag (e.g. with a space) updates
 *  only the attribute. */
export function renameNode(doc: TwuiDocument, guid: string, newId: string): void {
  const tag = tagNameForId(newId);
  const loc = locateHier(doc, guid);
  if (loc && tag) loc.node.tag = tag;
  const comp = componentByGuid(doc, guid);
  if (comp) {
    if (tag) comp.tag = tag;
    setAttr(comp, "id", newId);
  }
}

// --- Structural CRUD below the component level (states / component images / image-metrics /
//     callbacks). Addressing is by element-child INDEX within the parent container, so it works
//     uniformly whether or not the child carries a guid. New elements get a fresh this/uniqueguid
//     so their attributes are immediately editable. All of these run inside `mutate`. ---

/** Find or create a direct child container with `tag`; clears self_closing on creation. */
function ensureContainer(parent: RawElement, tag: string): RawElement {
  const existing = childByTag(parent, tag);
  if (existing) return existing;
  const c: RawElement = { kind: "element", tag, attrs: [], children: [], self_closing: false };
  parent.children.push(c);
  parent.self_closing = false;
  return c;
}

function appendChild(container: RawElement, el: RawElement): void {
  container.children.push(el);
  container.self_closing = false;
}

/** Swap the element-child at element-index `index` with its neighbour (dir -1 up / +1 down). */
function moveChildAt(container: RawElement, index: number, dir: -1 | 1): void {
  const kids = elementChildren(container);
  const j = index + dir;
  if (index < 0 || index >= kids.length || j < 0 || j >= kids.length) return;
  const a = container.children.indexOf(kids[index]);
  const b = container.children.indexOf(kids[j]);
  if (a < 0 || b < 0) return;
  [container.children[a], container.children[b]] = [container.children[b], container.children[a]];
}

/** Remove the element-child at element-index `index`; returns it. */
function removeChildAt(container: RawElement, index: number): RawElement | undefined {
  const kids = elementChildren(container);
  if (index < 0 || index >= kids.length) return undefined;
  const at = container.children.indexOf(kids[index]);
  if (at < 0) return undefined;
  return container.children.splice(at, 1)[0] as RawElement;
}

/** Generic reorder of a child within a named container of the element addressed by `parentGuid`. */
export function moveChild(
  doc: TwuiDocument,
  parentGuid: string,
  containerTag: string,
  index: number,
  dir: -1 | 1
): void {
  const parent = findComponentElement(doc, parentGuid);
  const cont = parent && childByTag(parent, containerTag);
  if (cont) moveChildAt(cont, index, dir);
}

/** Generic remove of a child (no reference cleanup) — used for image-metrics and callbacks. */
export function removeChild(
  doc: TwuiDocument,
  parentGuid: string,
  containerTag: string,
  index: number
): void {
  const parent = findComponentElement(doc, parentGuid);
  const cont = parent && childByTag(parent, containerTag);
  if (cont) removeChildAt(cont, index);
}

/** Set an attribute on a child element addressed by container + element index (the child may carry
 *  no guid of its own — e.g. an `<imagemetrics><image>` draw entry, which can't be reached via the
 *  guid-based editAttr). Mirrors moveChild/removeChild's parent+container resolution. */
export function editChildAttr(
  doc: TwuiDocument,
  parentGuid: string,
  containerTag: string,
  index: number,
  key: string,
  value: string
): void {
  const parent = findComponentElement(doc, parentGuid);
  const cont = parent && childByTag(parent, containerTag);
  if (!cont) return;
  const el = elementChildren(cont)[index];
  if (el) setAttr(el, key, value);
}

// --- States ---

function uniqueStateName(statesEl: RawElement): string {
  const used = new Set(elementChildren(statesEl).map((s) => getAttr(s, "name")));
  if (!used.has("NewState")) return "NewState";
  for (let i = 2; ; i++) if (!used.has(`NewState ${i}`)) return `NewState ${i}`;
}

/** Add a new state to a component; points current/default state at it if unset. Returns its guid. */
export function addState(doc: TwuiDocument, compGuid: string): string | undefined {
  const comp = findComponentElement(doc, compGuid);
  if (!comp) return undefined;
  const statesEl = ensureContainer(comp, "states");
  const sample = elementChildren(statesEl)[0];
  const stateGuid = genGuid();
  const state: RawElement = {
    kind: "element",
    tag: "newstate",
    attrs: [
      ["this", stateGuid],
      ["name", uniqueStateName(statesEl)],
      ["width", (sample && getAttr(sample, "width")) ?? "100"],
      ["height", (sample && getAttr(sample, "height")) ?? "40"],
      ["interactive", "true"],
      ["uniqueguid", stateGuid],
    ],
    children: [],
    self_closing: true,
  };
  appendChild(statesEl, state);
  if (!getAttr(comp, "currentstate")) setAttr(comp, "currentstate", stateGuid);
  if (!getAttr(comp, "defaultstate")) setAttr(comp, "defaultstate", stateGuid);
  return stateGuid;
}

/** Delete a state by index; repoints current/default state to the first survivor (or drops it). */
export function deleteState(doc: TwuiDocument, compGuid: string, index: number): void {
  const comp = findComponentElement(doc, compGuid);
  const statesEl = comp && childByTag(comp, "states");
  if (!comp || !statesEl) return;
  const removed = removeChildAt(statesEl, index);
  const removedGuid = removed && guidOf(removed);
  if (!removedGuid) return;
  const firstGuid = elementChildren(statesEl)[0] ? guidOf(elementChildren(statesEl)[0]) : undefined;
  for (const key of ["currentstate", "defaultstate"]) {
    if (getAttr(comp, key) === removedGuid) {
      if (firstGuid) setAttr(comp, key, firstGuid);
      else removeAttr(comp, key);
    }
  }
}

// --- Component images ---

/** Add an empty <component_image> to a component. Returns its guid. */
export function addComponentImage(doc: TwuiDocument, compGuid: string): string | undefined {
  const comp = findComponentElement(doc, compGuid);
  if (!comp) return undefined;
  const cont = ensureContainer(comp, "componentimages");
  const g = genGuid();
  appendChild(cont, {
    kind: "element",
    tag: "component_image",
    attrs: [
      ["this", g],
      ["uniqueguid", g],
      ["imagepath", ""],
      ["width", "0"],
      ["height", "0"],
    ],
    children: [],
    self_closing: true,
  });
  return g;
}

/** Delete a component image by index; cascade-removes state image-metrics that referenced it. */
export function deleteComponentImage(doc: TwuiDocument, compGuid: string, index: number): void {
  const comp = findComponentElement(doc, compGuid);
  const cont = comp && childByTag(comp, "componentimages");
  if (!comp || !cont) return;
  const removed = removeChildAt(cont, index);
  const ciGuid = removed && guidOf(removed);
  if (!ciGuid) return;
  const statesEl = childByTag(comp, "states");
  if (!statesEl) return;
  for (const st of elementChildren(statesEl)) {
    const im = childByTag(st, "imagemetrics");
    if (im) {
      im.children = im.children.filter(
        (c) => !(isElement(c) && getAttr(c, "componentimage") === ciGuid)
      );
    }
  }
}

// --- Image-metrics (a state's <imagemetrics><image> draw layers) ---

/** Add an <image> draw layer to a state, referencing component image `ciGuid`. Returns its guid. */
export function addImageMetric(
  doc: TwuiDocument,
  stateGuid: string,
  ciGuid: string | undefined
): string | undefined {
  const state = findComponentElement(doc, stateGuid);
  if (!state) return undefined;
  const cont = ensureContainer(state, "imagemetrics");
  const g = genGuid();
  appendChild(cont, {
    kind: "element",
    tag: "image",
    attrs: [
      ["componentimage", ciGuid ?? ""],
      ["this", g],
      ["uniqueguid", g],
      ["width", "0"],
      ["height", "0"],
    ],
    children: [],
    self_closing: true,
  });
  return g;
}

// --- Callbacks (<callbackwithcontextlist|callbacks_with_context><callback_with_context>) ---

/** Add an empty callback under the inline list (creating it if needed). */
export function addCallback(doc: TwuiDocument, compGuid: string): void {
  const comp = findComponentElement(doc, compGuid);
  if (!comp) return;
  const cont =
    childByTag(comp, "callbackwithcontextlist") ??
    childByTag(comp, "callbacks_with_context") ??
    ensureContainer(comp, "callbackwithcontextlist");
  appendChild(cont, {
    kind: "element",
    tag: "callback_with_context",
    attrs: [["callback_id", ""]],
    children: [],
    self_closing: true,
  });
}

/** Set one attribute of a callback addressed by (container tag, element index). */
export function setCallbackAttr(
  doc: TwuiDocument,
  compGuid: string,
  containerTag: string,
  index: number,
  key: string,
  value: string
): void {
  const comp = findComponentElement(doc, compGuid);
  const cont = comp && childByTag(comp, containerTag);
  if (!cont) return;
  const el = elementChildren(cont)[index];
  if (el) setAttr(el, key, value);
}

export function isElementNode(n: TwuiNode): n is RawElement {
  return isElement(n);
}

export { childByTag };
