// Component quick-find + reference search over an open document. Pure (no React /
// store), so it is headless-testable. Walks the hierarchy in document order so hits
// are stable and only real components (not orphaned <components> entries) are listed.

import { RawElement, TwuiDocument } from "../types/twui";
import {
  activeState,
  componentMap,
  componentsSection,
  elementChildren,
  getAttr,
  guidOf,
  hierarchyRoot,
} from "./doc";
import { decodeEntities } from "./cco";

export type MatchKind = "id" | "tag" | "guid" | "text" | "ref";

export interface SearchHit {
  guid: string;
  tag: string;
  id: string;
  /** The decoded state text, if any (used for text matches + display). */
  text?: string;
  hidden: boolean;
  matchKind: MatchKind;
  /** Lower is better (used for ranking). */
  score: number;
}

function isHidden(comp: RawElement | undefined): boolean {
  return !!comp && (getAttr(comp, "visible") === "false" || getAttr(comp, "is_visible") === "false");
}

/** The decoded display text of a component's active (else first) state, if any. */
function stateText(comp: RawElement): string | undefined {
  const t = getAttr(activeState(comp) ?? comp, "text");
  return t ? decodeEntities(t) : undefined;
}

/** Rank a component against a lowercased query; returns [score, matchKind] or null. */
function rank(
  id: string,
  tag: string,
  guid: string,
  text: string | undefined,
  q: string
): [number, MatchKind] | null {
  const idl = id.toLowerCase();
  if (idl === q) return [0, "id"];
  if (idl.startsWith(q)) return [1, "id"];
  if (idl.includes(q)) return [2, "id"];
  if (tag.toLowerCase().includes(q)) return [3, "tag"];
  if (guid.toLowerCase().includes(q)) return [4, "guid"];
  if (text && text.toLowerCase().includes(q)) return [5, "text"];
  return null;
}

/** Find components matching `query` (id / tag / guid / state text), best first. */
export function searchComponents(doc: TwuiDocument, query: string, limit = 50): SearchHit[] {
  const root = hierarchyRoot(doc);
  if (!root) return [];
  const cmap = componentMap(doc);
  const q = query.trim().toLowerCase();
  const hits: (SearchHit & { order: number })[] = [];
  let order = 0;

  const walk = (node: RawElement) => {
    const guid = guidOf(node) ?? "";
    const comp = cmap.get(guid);
    if (comp) {
      const i = order++;
      const id = getAttr(comp, "id") ?? "";
      const tag = comp.tag;
      const text = stateText(comp);
      const make = (matchKind: MatchKind, score: number): SearchHit & { order: number } => ({
        guid,
        tag,
        id,
        text,
        hidden: isHidden(comp),
        matchKind,
        score,
        order: i,
      });
      if (!q) {
        if (hits.length < limit) hits.push(make("id", 0));
      } else {
        const r = rank(id, tag, guid, text, q);
        if (r) hits.push(make(r[1], r[0]));
      }
    }
    for (const c of elementChildren(node)) walk(c);
  };
  walk(root);

  hits.sort((a, b) => a.score - b.score || a.order - b.order);
  return hits.slice(0, limit).map(({ order: _order, ...h }) => h);
}

/** Recursively test whether any attribute value in `el`'s subtree contains `needle`. */
function subtreeHasValue(el: RawElement, needle: string): boolean {
  for (const [, v] of el.attrs) if (v.includes(needle)) return true;
  for (const c of elementChildren(el)) if (subtreeHasValue(c, needle)) return true;
  return false;
}

/** Components that reference `guid` anywhere in their subtree (e.g. a callback
 *  `Component("<guid>")`). The guid string is identical escaped or not, so a raw
 *  substring scan suffices; the target component itself is excluded. */
export function findReferences(doc: TwuiDocument, guid: string): SearchHit[] {
  if (!guid) return [];
  const comps = componentsSection(doc);
  if (!comps) return [];
  const out: SearchHit[] = [];
  for (const comp of elementChildren(comps)) {
    const g = guidOf(comp) ?? "";
    if (g === guid) continue; // not a reference to itself
    if (subtreeHasValue(comp, guid)) {
      out.push({
        guid: g,
        tag: comp.tag,
        id: getAttr(comp, "id") ?? "",
        text: stateText(comp),
        hidden: isHidden(comp),
        matchKind: "ref",
        score: 0,
      });
    }
  }
  return out;
}
