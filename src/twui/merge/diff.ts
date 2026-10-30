// The Merge Mode diff engine: compute a structural diff of document B (incoming) relative to
// document A (base), as a tree of accept/reject-able ChangeNodes. See ../../.. plan; key rules:
//
//  - Diff the MODEL tree, not raw XML. The Rust serializer is a pure function of the tree, so
//    untouched subtrees re-emit byte-identically.
//  - The "component universe" is the set of guids present in each <hierarchy>. Every hierarchy
//    node has a matching <components> def by guid; matched guids are content+position-diffed,
//    B-only guids are adds, A-only guids are removes.
//  - Granularity is two levels of accept: (1) a component root attribute, (2) a whole direct-of-
//    component nested element (a state, component_image, localised_text, transition, callback,
//    material entry, animation, LayoutEngine, model view). Structures INSIDE a state (image draw
//    layers, component_text) are shown as detail but adopted with the whole state — this keeps
//    apply to a shallow, provably-correct shape. Accepting every child of a component adopts B's
//    whole def verbatim (order-faithful); partial accept edits key/index-wise.
//  - Attribute/child comparison ignores attribute ORDER (order is not game-significant and would
//    be noise) but respects child order (z-order / draw order is significant).

import type { RawElement, TwuiDocument } from "../../types/twui";
import {
  componentsSection,
  elementChildren,
  getAttr,
  guidOf,
  hierarchyRoot,
  layoutVersion,
} from "../doc";
import { migrateLayout } from "../migrate";
import { componentSpine } from "./spine";
import type { AttrDelta, ChangeKind, ChangeLevel, ChangeNode, MergeDiff, MoveTarget } from "./types";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

// --- Indexing helpers ---------------------------------------------------------------------------

interface HierInfo {
  parentGuid: string | null;
  index: number; // index among the parent's element-children
  node: RawElement;
}

/** Map every hierarchy node guid -> its parent guid + sibling index + node (first wins on dups). */
function hierIndex(doc: TwuiDocument): Map<string, HierInfo> {
  const map = new Map<string, HierInfo>();
  const root = hierarchyRoot(doc);
  if (!root) return map;
  const rg = guidOf(root);
  if (rg && !map.has(rg)) map.set(rg, { parentGuid: null, index: 0, node: root });
  const recurse = (parent: RawElement) => {
    const pg = guidOf(parent) ?? null;
    elementChildren(parent).forEach((k, i) => {
      const g = guidOf(k);
      if (g && !map.has(g)) map.set(g, { parentGuid: pg, index: i, node: k });
      recurse(k);
    });
  };
  recurse(root);
  return map;
}

interface CompIndex {
  list: RawElement[];
  byGuid: Map<string, number[]>;
}

function compIndexMap(doc: TwuiDocument): CompIndex {
  const comps = componentsSection(doc);
  const list = comps ? elementChildren(comps) : [];
  const byGuid = new Map<string, number[]>();
  list.forEach((c, i) => {
    const g = guidOf(c);
    if (g) {
      const arr = byGuid.get(g) ?? [];
      arr.push(i);
      byGuid.set(g, arr);
    }
  });
  return { list, byGuid };
}

// --- Equality (attr-order-insensitive, child-order-sensitive) -----------------------------------

function attrMap(el: RawElement): Map<string, string> {
  return new Map(el.attrs.map((a) => [a[0], a[1]]));
}

function elementsEqual(a: RawElement, b: RawElement): boolean {
  if (a.tag !== b.tag) return false;
  const ma = attrMap(a);
  const mb = attrMap(b);
  if (ma.size !== mb.size) return false;
  for (const [k, v] of ma) if (mb.get(k) !== v) return false;
  const ea = elementChildren(a);
  const eb = elementChildren(b);
  if (ea.length !== eb.length) return false;
  for (let i = 0; i < ea.length; i++) if (!elementsEqual(ea[i], eb[i])) return false;
  return true;
}

/** Per-attribute A→B deltas over the union of keys (raw values; only where they differ). */
function attrDeltas(a: RawElement | undefined, b: RawElement | undefined, exclude: Set<string> = new Set()): AttrDelta[] {
  const ma = a ? attrMap(a) : new Map<string, string>();
  const mb = b ? attrMap(b) : new Map<string, string>();
  const keys = new Set<string>([...ma.keys(), ...mb.keys()]);
  const out: AttrDelta[] = [];
  for (const k of keys) {
    if (exclude.has(k)) continue;
    const av = ma.get(k);
    const bv = mb.get(k);
    if (av !== bv) out.push({ key: k, a: av, b: bv });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

// --- Labels -------------------------------------------------------------------------------------

function componentLabel(def: RawElement | undefined, node: RawElement | undefined): string {
  return (def && getAttr(def, "id")) || node?.tag || def?.tag || "component";
}

function nestedLabel(level: ChangeLevel, el: RawElement | undefined): string {
  if (!el) return level;
  switch (level) {
    case "state":
      return `state ${getAttr(el, "name") ?? guidOf(el) ?? ""}`.trim();
    case "component_image":
      return `image ${basename(getAttr(el, "imagepath") ?? "")}`.trim();
    case "localised_text":
      return `text [${getAttr(el, "state") || "*"}]`;
    case "transition":
      return `transition ${getAttr(el, "index") ?? ""}`.trim();
    case "callback":
      return `callback ${getAttr(el, "callback_id") ?? ""}`.trim();
    case "layoutEngine":
      return "LayoutEngine";
    case "model":
      return "model view";
    case "material_parameter":
      return `material ${getAttr(el, "name") ?? ""}`.trim();
    case "material_texture":
      return `texture ${getAttr(el, "slot_id") ?? ""}`.trim();
    case "animation":
      return `anim ${getAttr(el, "id") ?? el.tag}`;
    default:
      return level;
  }
}

// --- Reference collection (for advisory dependsOn / dangling warnings) ---------------------------

/** Attribute keys whose value is a guid reference to another element in the same file. */
const REF_KEYS = new Set([
  "currentstate",
  "defaultstate",
  "componentimage",
  "maskimage",
  "transition_m_target_state",
  "trigger_component",
]);

function collectRefGuids(el: RawElement): Set<string> {
  const out = new Set<string>();
  const walk = (e: RawElement) => {
    for (const [k, v] of e.attrs) if (REF_KEYS.has(k) && v) out.add(v);
    for (const c of elementChildren(e)) walk(c);
  };
  walk(el);
  return out;
}

/** Guids this element DEFINES (its own `this`, and any nested `this`). */
function collectDefGuids(el: RawElement): Set<string> {
  const out = new Set<string>();
  const walk = (e: RawElement) => {
    const g = getAttr(e, "this");
    if (g) out.add(g);
    for (const c of elementChildren(e)) walk(c);
  };
  walk(el);
  return out;
}

// --- Content diff of one matched component ------------------------------------------------------

const IDENTITY_ATTRS = new Set(["this", "uniqueguid"]);

/** Child change nodes for a matched component pair (attr-level + nested-element-level). */
function contentChildren(g: string, aIdx: number, aComp: RawElement, bComp: RawElement): ChangeNode[] {
  const out: ChangeNode[] = [];

  // Component-root attributes (identity attrs excluded — managed by add/remove/regen, not merge).
  for (const d of attrDeltas(aComp, bComp, IDENTITY_ATTRS)) {
    out.push({
      id: `comp:${g}/attr:${d.key}`,
      level: "attr",
      kind: d.a === undefined ? "add" : d.b === undefined ? "remove" : "modify",
      label: d.key,
      compGuid: g,
      compIndex: aIdx,
      ownerGuid: g,
      attrKey: d.key,
      before: d.a,
      after: d.b,
      children: [],
      dependsOn: [],
    });
  }

  // Direct-of-component nested elements (state-internal images / component_text excluded — shown
  // as detail on the whole-state node).
  const keep = (level: ChangeLevel) => level !== "image" && level !== "component_text";
  const spineA = componentSpine(aComp).filter((e) => keep(e.level));
  const spineB = componentSpine(bComp).filter((e) => keep(e.level));

  const tags = new Set<string>([...spineA.map((e) => e.containerTag), ...spineB.map((e) => e.containerTag)]);
  const defGuidToNode = new Map<string, string>(); // guid a node defines -> node id (for dependsOn)

  for (const tag of tags) {
    const aByKey = new Map(spineA.filter((e) => e.containerTag === tag).map((e) => [e.key, e] as const));
    const bByKey = new Map(spineB.filter((e) => e.containerTag === tag).map((e) => [e.key, e] as const));
    const keys = new Set<string>([...aByKey.keys(), ...bByKey.keys()]);
    for (const key of keys) {
      const ae = aByKey.get(key);
      const be = bByKey.get(key);
      const level = (ae ?? be)!.level;
      let kind: ChangeKind;
      if (ae && be) {
        if (elementsEqual(ae.el, be.el)) continue;
        kind = "modify";
      } else if (be) {
        kind = "add";
      } else {
        kind = "remove";
      }
      const bEl = be ? clone(be.el) : undefined;
      const aEl = ae?.el;
      const node: ChangeNode = {
        id: `comp:${g}/${tag || "*"}:${key}`,
        level,
        kind,
        label: nestedLabel(level, be?.el ?? aEl),
        compGuid: g,
        compIndex: aIdx,
        ownerGuid: g,
        containerTag: tag,
        aIndex: ae ? ae.index : -1,
        bEl,
        attrs: attrDeltas(aEl, be?.el),
        children: [],
        dependsOn: [],
      };
      out.push(node);
      // Record guids this add/modify defines, so siblings that reference them can depend on it.
      if (bEl && (kind === "add" || kind === "modify")) {
        for (const dg of collectDefGuids(bEl)) defGuidToNode.set(dg, node.id);
      }
    }
  }

  // Advisory dependencies: a node that references a guid defined by another (added/modified) node.
  for (const node of out) {
    if (!node.bEl) continue;
    for (const ref of collectRefGuids(node.bEl)) {
      const dep = defGuidToNode.get(ref);
      if (dep && dep !== node.id) node.dependsOn.push(dep);
    }
  }

  return out;
}

// --- Position (move / reorder) ------------------------------------------------------------------

/** The guid of the next sibling (after `index`) that also exists in `shared` — the stable "before"
 *  anchor used to detect reorders and to place a node. */
function nextSharedSibling(
  hier: Map<string, HierInfo>,
  parentGuid: string | null,
  index: number,
  shared: Set<string>
): string | null {
  if (parentGuid === null) return null;
  const parent = hier.get(parentGuid);
  if (!parent) return null;
  const sibs = elementChildren(parent.node);
  for (let i = index + 1; i < sibs.length; i++) {
    const g = guidOf(sibs[i]);
    if (g && shared.has(g)) return g;
  }
  return null;
}

// --- Main -------------------------------------------------------------------------------------

export interface DiffOptions {
  /** When A and B are different layout versions, migrate a clone of B to A's version before
   *  diffing (default true) so incoming attributes match A's schema. */
  migrateIncoming?: boolean;
}

export function diffDocuments(a: TwuiDocument, bInput: TwuiDocument, opts: DiffOptions = {}): MergeDiff {
  const versionA = layoutVersion(a);
  const versionB = layoutVersion(bInput);

  let b = bInput;
  let migrationNote: string | undefined;
  if ((opts.migrateIncoming ?? true) && versionA && versionB && versionA !== versionB) {
    const bClone = clone(bInput);
    const res = migrateLayout(bClone, versionA);
    b = bClone;
    migrationNote = `Incoming file is v${versionB}; diffed as migrated to v${versionA} (${res.renamed} renamed, ${res.removed} removed).`;
  }

  const hierA = hierIndex(a);
  const hierB = hierIndex(b);
  const compsA = compIndexMap(a);
  const compsB = compIndexMap(b);

  const guidsA = new Set(hierA.keys());
  const guidsB = new Set(hierB.keys());
  const shared = new Set<string>();
  for (const g of guidsA) if (guidsB.has(g)) shared.add(g);
  const related = shared.size / Math.max(1, Math.min(guidsA.size, guidsB.size)) >= 0.5;

  const firstDefIndex = (ci: CompIndex, g: string): number | undefined => ci.byGuid.get(g)?.[0];
  const isDup = (g: string) =>
    (compsA.byGuid.get(g)?.length ?? 0) > 1 || (compsB.byGuid.get(g)?.length ?? 0) > 1;

  const roots: ChangeNode[] = [];

  // MATCHED (content + position) and A-only (remove), in A hierarchy order.
  for (const [g, ha] of hierA) {
    if (!guidsB.has(g)) {
      // A-only: remove the topmost A-only subtree (skip if the parent is also A-only).
      if (ha.parentGuid && !guidsB.has(ha.parentGuid)) continue;
      const aDefIdx = firstDefIndex(compsA, g) ?? -1;
      const aDef = aDefIdx >= 0 ? compsA.list[aDefIdx] : undefined;
      roots.push({
        id: `comp:${g}`,
        level: "component",
        kind: "remove",
        label: componentLabel(aDef, ha.node),
        compGuid: g,
        compIndex: aDefIdx,
        ownerGuid: g,
        children: [],
        dependsOn: [],
      });
      continue;
    }

    // Matched.
    const aDefIdx = firstDefIndex(compsA, g);
    const bDefIdx = firstDefIndex(compsB, g);
    if (aDefIdx === undefined || bDefIdx === undefined) continue; // orphan hierarchy node, no def
    const aDef = compsA.list[aDefIdx];
    const bDef = compsB.list[bDefIdx];
    const hb = hierB.get(g)!;

    const dup = isDup(g);
    const children = dup ? [] : contentChildren(g, aDefIdx, aDef, bDef);
    const contentChanged = dup ? !elementsEqual(aDef, bDef) : children.length > 0;

    // Position change: parent changed (move) or the stable "before" anchor changed (reorder).
    const targetBefore = nextSharedSibling(hierB, hb.parentGuid, hb.index, shared);
    const currentBefore = nextSharedSibling(hierA, ha.parentGuid, ha.index, shared);
    const parentChanged = ha.parentGuid !== hb.parentGuid && hb.parentGuid !== null;
    const reordered = !parentChanged && targetBefore !== currentBefore;
    const needsMove = parentChanged || reordered;
    const moveTo: MoveTarget | undefined =
      needsMove && hb.parentGuid ? { parentGuid: hb.parentGuid, beforeGuid: targetBefore } : undefined;

    if (!contentChanged && !moveTo) continue; // no change

    if (contentChanged) {
      const root: ChangeNode = {
        id: `comp:${g}`,
        level: "component",
        kind: "modify",
        label: componentLabel(bDef, hb.node),
        compGuid: g,
        compIndex: aDefIdx,
        ownerGuid: g,
        bEl: clone(bDef),
        children,
        dependsOn: [],
        coarseOnly: dup || undefined,
      };
      if (moveTo) {
        root.children.push({
          id: `comp:${g}/move`,
          level: "component",
          kind: parentChanged ? "move" : "reorder",
          label: parentChanged ? "reparent" : "reorder",
          compGuid: g,
          compIndex: aDefIdx,
          ownerGuid: g,
          moveTo,
          children: [],
          dependsOn: [],
        });
      }
      roots.push(root);
    } else if (moveTo) {
      roots.push({
        id: `comp:${g}`,
        level: "component",
        kind: parentChanged ? "move" : "reorder",
        label: componentLabel(bDef, hb.node),
        compGuid: g,
        compIndex: aDefIdx,
        ownerGuid: g,
        moveTo,
        children: [],
        dependsOn: [],
      });
    }
  }

  // B-only ADDs (topmost B-only subtree whose parent exists in A), in B hierarchy order.
  for (const [g, hb] of hierB) {
    if (guidsA.has(g)) continue;
    const pg = hb.parentGuid;
    if (!pg || !guidsA.has(pg)) continue; // root, or parent is itself a B-only add (covered by ancestor)

    const subtreeGuids = collectDefGuids(hb.node); // every `this` in the B-only subtree
    const subtreeDefs: RawElement[] = [];
    for (const sg of subtreeGuids) {
      const idx = firstDefIndex(compsB, sg);
      if (idx !== undefined && !guidsA.has(sg)) subtreeDefs.push(clone(compsB.list[idx]));
    }
    const beforeGuid = nextSharedSibling(hierB, pg, hb.index, guidsA);
    const bDef = firstDefIndex(compsB, g) !== undefined ? compsB.list[firstDefIndex(compsB, g)!] : undefined;

    roots.push({
      id: `comp:${g}`,
      level: "component",
      kind: "add",
      label: componentLabel(bDef, hb.node),
      compGuid: g,
      compIndex: -1,
      ownerGuid: g,
      bHier: clone(hb.node),
      bComps: subtreeDefs,
      moveTo: { parentGuid: pg, beforeGuid },
      children: [],
      dependsOn: [],
    });
  }

  const byId: Record<string, ChangeNode> = {};
  const index = (n: ChangeNode) => {
    byId[n.id] = n;
    for (const c of n.children) index(c);
  };
  for (const r of roots) index(r);

  return { versionA, versionB, related, migrationNote, roots, byId };
}
