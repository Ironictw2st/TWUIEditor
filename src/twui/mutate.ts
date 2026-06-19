// Structural mutations over the raw TWUI document. All functions mutate in
// place (intended to run inside an immer producer). They keep the <hierarchy>
// tree and the <components> section consistent.

import { isElement, RawElement, TwuiDocument, TwuiNode } from "../types/twui";
import {
  childByTag,
  componentsSection,
  elementChildren,
  getAttr,
  guidOf,
  hierarchyRoot,
  hierarchySection,
  setAttr,
} from "./doc";

export function genGuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 32)}`;
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
}

/** Deep-clone a node JSON-style. */
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Duplicate a hierarchy node + its components with fresh GUIDs, inserted as a sibling. */
export function duplicateNode(doc: TwuiDocument, guid: string): string | undefined {
  const loc = locateHier(doc, guid);
  if (!loc || !loc.parent) return undefined;

  const guids = subtreeGuids(loc.node);
  const comps = guids
    .map((g) => componentByGuid(doc, g))
    .filter((c): c is RawElement => !!c);

  // Build a remap for every defining guid (this/uniqueguid) across hierarchy + components.
  const remap = new Map<string, string>();
  const define = (g?: string) => {
    if (g && !remap.has(g)) remap.set(g, genGuid());
  };
  walk(loc.node, (e) => define(getAttr(e, "this")));
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

  // Clone hierarchy subtree.
  const newHier = clone(loc.node);
  remapAttrs(newHier);
  const at = loc.parent.children.indexOf(loc.node);
  loc.parent.children.splice(at + 1, 0, newHier);

  // Clone components.
  const compsSection = componentsSection(doc);
  if (compsSection) {
    for (const c of comps) {
      const nc = clone(c);
      remapAttrs(nc);
      compsSection.children.push(nc);
    }
  }

  return remap.get(guid);
}

/** Add a new child component under the given parent hierarchy node. */
export function addNode(doc: TwuiDocument, parentGuid: string, tag: string): string | undefined {
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
      ["offset", "0.00,0.00"],
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

/** Rename a node's id (updates both hierarchy tag and component id/tag). */
export function renameNode(doc: TwuiDocument, guid: string, newId: string): void {
  const loc = locateHier(doc, guid);
  if (loc) loc.node.tag = newId;
  const comp = componentByGuid(doc, guid);
  if (comp) {
    comp.tag = newId;
    setAttr(comp, "id", newId);
  }
}

export function isElementNode(n: TwuiNode): n is RawElement {
  return isElement(n);
}

export { childByTag };
