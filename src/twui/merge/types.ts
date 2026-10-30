// The change model for Merge Mode: a structural diff of document B (incoming) relative to
// document A (base/destination), shaped as a tree of accept/reject-able changes — a Git-PR
// review over the raw TWUI tree. The diff is a pure value (see diff.ts); selection lives
// separately (a Set/Record keyed by ChangeNode.id) so both a modal and a panel can bind to it.
//
// Apply (see apply.ts) reads the explicit fields on each node rather than a giant discriminated
// union — matching the codebase's pragmatic style. Nodes carry deep-cloned B elements where
// byte fidelity matters, so apply never re-derives geometry from the diff.

import type { RawElement } from "../../types/twui";

export type ChangeKind = "add" | "remove" | "modify" | "move" | "reorder";

/** The structural level a change sits at. `component` is a root node; the rest are sub-changes
 *  under a modified component. `attr` is a single attribute of the component root. */
export type ChangeLevel =
  | "component"
  | "attr"
  | "layoutEngine"
  | "state"
  | "image"
  | "component_image"
  | "localised_text"
  | "transition"
  | "callback"
  | "callback_prop"
  | "material_parameter"
  | "material_texture"
  | "model"
  | "animation"
  | "component_text";

/** One attribute's A→B delta (raw stored values; undefined = absent on that side). Display + the
 *  granular value source for attr-level applies. */
export interface AttrDelta {
  key: string;
  a?: string;
  b?: string;
}

/** Where in A's hierarchy a moved/reordered node should land. */
export interface MoveTarget {
  parentGuid: string;
  beforeGuid: string | null; // insert before this sibling guid; null = append
}

/**
 * A single reviewable change. Component-level changes are roots; sub-changes hang under a
 * `modify` component root. Fields are optional and populated per (level, kind):
 *
 * - component/add  → `bHier` (B hierarchy node) + `bComps` (B component defs subtree) + `moveTo`.
 * - component/remove → addressed by `compGuid`.
 * - component/modify → container node; `bEl` = B's whole component def (adopt source when every
 *   content child is accepted), `compIndex` = A-side index in <components> (dup-guid-safe).
 * - component/move|reorder → `moveTo`.
 * - attr (component root) → `attrKey`, `before`/`after`.
 * - nested element (state/image/…): `containerTag`, `aIndex` (index in A's container; -1 for adds),
 *   `bEl` (clone of B's element for add/modify), `ownerGuid` (component OR state guid the container
 *   hangs off), `attrs` (per-attr breakdown for display).
 */
export interface ChangeNode {
  id: string; // stable, path-derived, e.g. "comp:<guid>/state:<key>" or "comp:<guid>/attr:width"
  level: ChangeLevel;
  kind: ChangeKind;
  label: string;

  /** Owning component's guid (A side; the match key). Null only for unmatched-add display. */
  compGuid: string | null;
  /** Index of the owning component within A's <components> (-1 when the component is an add). */
  compIndex: number;
  /** The element a granular sub-change hangs off — a component OR a state guid. */
  ownerGuid: string | null;

  // Nested-element addressing / adopt sources.
  containerTag?: string;
  aIndex?: number; // element-index within A's container (-1 for adds)
  attrKey?: string; // for level "attr"

  before?: string; // A-side scalar (attr value / display)
  after?: string; // B-side scalar (attr value / display)
  attrs?: AttrDelta[]; // per-attr breakdown for an element add/remove/modify (display + adopt)

  bEl?: RawElement; // clone of B's element (component def for a modify root; sub-element otherwise)
  bHier?: RawElement; // clone of B's hierarchy node (component add)
  bComps?: RawElement[]; // clone of B's component defs subtree (component add)
  moveTo?: MoveTarget; // for move/reorder (and the target parent of an add)

  children: ChangeNode[];
  /** ids of changes this one references (cross-ref) — advisory: drives dangling-ref warnings and
   *  "accept with dependencies". Parent/child structure is expressed by the tree, not here. */
  dependsOn: string[];
  /** Ambiguous (duplicate-guid) component: only a whole-component accept is offered, and apply
   *  addresses it by `compIndex`, never by guid lookup. */
  coarseOnly?: boolean;
}

export interface MergeDiff {
  versionA: number;
  versionB: number;
  /** True when B looks derived from A (high guid overlap) — the optimized case. Low overlap ⇒
   *  best-effort id/path matching, and the UI warns the files may be unrelated. */
  related: boolean;
  /** Non-null when B was migrated to A's layout version before diffing (message for the UI). */
  migrationNote?: string;
  roots: ChangeNode[];
  /** id -> node, for selection + dependency lookup. A plain object (not a Map) so it lives happily
   *  inside the Zustand/immer store and never needs the immer MapSet plugin. */
  byId: Record<string, ChangeNode>;
}

// --- Selection helpers (pure functions over the diff's byId map) --------------------------------

/** A node's id plus every descendant id (parent accept cascades to children). */
export function subtreeIds(node: ChangeNode): string[] {
  const out: string[] = [node.id];
  for (const c of node.children) out.push(...subtreeIds(c));
  return out;
}

/** Every id in the diff (all roots' subtrees). */
export function allIds(diff: MergeDiff): string[] {
  return diff.roots.flatMap(subtreeIds);
}

/** Build reverse dependency edges: dependencyId -> ids that depend on it. */
function reverseDeps(byId: Record<string, ChangeNode>): Record<string, string[]> {
  const rev: Record<string, string[]> = {};
  for (const node of Object.values(byId)) {
    for (const dep of node.dependsOn) (rev[dep] ??= []).push(node.id);
  }
  return rev;
}

/**
 * Accept `id`: select it, its whole subtree, and (transitively) everything it dependsOn — so a
 * change is never applied while a change it references is left out. Returns a new selection.
 */
export function selectWithDeps(
  byId: Record<string, ChangeNode>,
  selection: Record<string, boolean>,
  id: string
): Record<string, boolean> {
  const next = { ...selection };
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = byId[cur];
    if (!node) continue;
    for (const sid of subtreeIds(node)) next[sid] = true;
    for (const dep of node.dependsOn) stack.push(dep);
  }
  return next;
}

/**
 * Reject `id`: deselect it, its whole subtree, and (transitively) anything that dependsOn it — so
 * a dependent change is never left applied without the change it needs. Returns a new selection.
 */
export function deselectWithDependents(
  byId: Record<string, ChangeNode>,
  selection: Record<string, boolean>,
  id: string
): Record<string, boolean> {
  const next = { ...selection };
  const rev = reverseDeps(byId);
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = byId[cur];
    if (!node) continue;
    for (const sid of subtreeIds(node)) next[sid] = false;
    for (const dependent of rev[cur] ?? []) stack.push(dependent);
  }
  return next;
}

/** Select every change (accept-all). */
export function selectAll(diff: MergeDiff): Record<string, boolean> {
  const sel: Record<string, boolean> = {};
  for (const id of allIds(diff)) sel[id] = true;
  return sel;
}
