// Apply an accepted subset of a MergeDiff into document A. Runs inside the store's `mutate`
// producer (immer), so it mutates `doc` in place and the whole call becomes ONE undo step.
//
// Dual-mode invariant: if EVERY content child of a modified component is accepted, adopt B's
// whole component def verbatim (order-faithful → accept-all == B). Partial accept edits key/index-
// wise. Phase order avoids index drift and dependency hazards:
//   1. component adds   (GUID-preserving; new comps append to <components>, no index shift)
//   2. content modifies (index-addressed on <components>, unaffected by later hierarchy moves)
//   3. moves / reorders (hierarchy only)
//   4. removes          (last, so moves still find their source)

import type { TwuiDocument } from "../../types/twui";
import { findComponentElement, removeAttr, setAttr } from "../doc";
import {
  appendContainerChild,
  deleteNode,
  insertComponentSubtree,
  moveNode,
  removeContainerChild,
  replaceComponentAt,
  replaceContainerChild,
  replaceNamedChild,
} from "../mutate";
import type { ChangeLevel, ChangeNode, MergeDiff } from "./types";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export interface ApplyReport {
  adds: number;
  removes: number;
  moves: number;
  modifies: number;
  /** ids of accepted changes that could not be applied (missing data) — surfaced for diagnostics. */
  skipped: string[];
}

/** Singleton named-child levels → the element tag to address them by. */
const SINGLETON_TAG: Partial<Record<ChangeLevel, string>> = {
  layoutEngine: "LayoutEngine",
  model: "component_model_view",
};

function isMove(n: ChangeNode): boolean {
  return n.kind === "move" || n.kind === "reorder";
}

/** Apply the accepted content children of a component granularly (partial accept). */
function applyGranular(doc: TwuiDocument, compGuid: string, kids: ChangeNode[]): void {
  const comp = findComponentElement(doc, compGuid);

  // 1. Component-root attributes (order-independent).
  if (comp) {
    for (const k of kids) {
      if (k.level !== "attr" || !k.attrKey) continue;
      if (k.kind === "remove") removeAttr(comp, k.attrKey);
      else if (k.after !== undefined) setAttr(comp, k.attrKey, k.after);
    }
  }

  // 2. Singleton named children (LayoutEngine / model view).
  for (const k of kids) {
    const tag = SINGLETON_TAG[k.level];
    if (!tag || !k.ownerGuid) continue;
    replaceNamedChild(doc, k.ownerGuid, tag, k.kind === "remove" ? null : k.bEl ? clone(k.bEl) : null);
  }

  // 3. List-container children, grouped by container. Modifies (in place) → removes (descending
  //    index) → adds (append), so indices never drift mid-container.
  const listKids = kids.filter((k) => k.level !== "attr" && k.level !== "component" && !SINGLETON_TAG[k.level]);
  const byTag = new Map<string, ChangeNode[]>();
  for (const k of listKids) {
    const t = k.containerTag ?? "";
    const arr = byTag.get(t);
    if (arr) arr.push(k);
    else byTag.set(t, [k]);
  }
  for (const [tag, group] of byTag) {
    const owner = group[0].ownerGuid;
    if (!owner) continue;
    for (const k of group) {
      if (k.kind === "modify" && k.aIndex != null && k.aIndex >= 0 && k.bEl) {
        replaceContainerChild(doc, owner, tag, k.aIndex, clone(k.bEl));
      }
    }
    const removes = group
      .filter((k) => k.kind === "remove" && k.aIndex != null && k.aIndex >= 0)
      .sort((a, b) => (b.aIndex as number) - (a.aIndex as number));
    for (const k of removes) removeContainerChild(doc, owner, tag, k.aIndex as number);
    for (const k of group) if (k.kind === "add" && k.bEl) appendContainerChild(doc, owner, tag, clone(k.bEl));
  }
}

function applyModify(
  doc: TwuiDocument,
  root: ChangeNode,
  accepted: Set<string>,
  report: ApplyReport
): void {
  if (root.coarseOnly) {
    if (accepted.has(root.id) && root.bEl) {
      replaceComponentAt(doc, root.compIndex, clone(root.bEl));
      report.modifies++;
    }
    return;
  }
  const content = root.children.filter((c) => !isMove(c));
  const acc = content.filter((c) => accepted.has(c.id));
  if (!acc.length) return;
  if (acc.length === content.length && root.bEl) {
    replaceComponentAt(doc, root.compIndex, clone(root.bEl)); // adopt whole def (order-faithful)
  } else if (root.compGuid) {
    applyGranular(doc, root.compGuid, acc);
  }
  report.modifies++;
}

/** Apply every accepted change in `diff` into `doc`. Call inside `store.mutate`. */
export function applyChanges(doc: TwuiDocument, diff: MergeDiff, accepted: Set<string>): ApplyReport {
  const report: ApplyReport = { adds: 0, removes: 0, moves: 0, modifies: 0, skipped: [] };
  const moveOps: ChangeNode[] = [];

  // Phase 1 — component adds (GUID-preserving whole subtrees).
  for (const r of diff.roots) {
    if (r.kind !== "add" || !accepted.has(r.id)) continue;
    if (r.bHier && r.bComps && r.moveTo) {
      insertComponentSubtree(doc, r.moveTo.parentGuid, r.moveTo.beforeGuid, r.bHier, r.bComps);
      report.adds++;
    } else {
      report.skipped.push(r.id);
    }
  }

  // Phase 2 — content modifies (and collect any move child for phase 3).
  for (const r of diff.roots) {
    if (r.kind !== "modify") continue;
    applyModify(doc, r, accepted, report);
    const mv = r.children.find(isMove);
    if (mv && accepted.has(mv.id)) moveOps.push(mv);
  }

  // Phase 3 — standalone moves + collected move children.
  for (const r of diff.roots) if (isMove(r) && accepted.has(r.id)) moveOps.push(r);
  for (const mv of moveOps) {
    if (mv.moveTo && mv.compGuid) {
      moveNode(doc, mv.compGuid, mv.moveTo.parentGuid, mv.moveTo.beforeGuid);
      report.moves++;
    }
  }

  // Phase 4 — removes (last).
  for (const r of diff.roots) {
    if (r.kind !== "remove" || !accepted.has(r.id)) continue;
    if (r.compGuid) {
      deleteNode(doc, r.compGuid);
      report.removes++;
    }
  }

  return report;
}
