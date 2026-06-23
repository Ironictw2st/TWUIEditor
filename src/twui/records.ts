// General DB-record context resolution: a `ContextTextLabel` bound to a record
// context (CcoEffectBundle, CcoCampaignPooledResource, …) gets its display text
// from a `text/db/*.loc.tsv` table, keyed by the record's key. The loc map holds
// these full-keyed (see Rust loc.rs); here we map object-type + property -> the
// loc key prefix, and find the record's key in scope.

import { RawElement, TwuiDocument } from "../types/twui";
import { ancestorGuids } from "./doc";
import { callbacks, Scope } from "./cco";

// The loc-prefix registry lives in a leaf module (import-free) so cco.ts can share it without
// an import cycle. Re-exported here for existing consumers (e.g. layout/compute.ts).
export { RECORD_LOC } from "./recordLoc";

/**
 * Records whose identity comes from a LITERAL in a `…Context("KEY")` callback on
 * the component or an ancestor (rather than from the current list row).
 */
const LITERAL_KEY: Record<string, RegExp> = {
  CcoCampaignPooledResource: /PooledResource\w*Context\(\s*"([^"]+)"\s*\)/,
};

/** The record key for a record-context binding on `guid`, or undefined. */
export function recordKeyFor(
  objectId: string,
  scope: Scope,
  doc: TwuiDocument,
  guid: string,
  cmap: Map<string, RawElement>
): string | undefined {
  const re = LITERAL_KEY[objectId];
  if (re) {
    // self first, then ancestors nearest -> root.
    const chain = [guid, ...ancestorGuids(doc, guid).slice().reverse()];
    for (const g of chain) {
      const c = cmap.get(g);
      if (!c) continue;
      for (const cb of callbacks(c)) {
        const m = cb.funcId ? re.exec(cb.funcId) : null;
        if (m) return m[1];
      }
    }
    return undefined;
  }
  // Row-bound record: its effect-bundle key, else its map key.
  const e = scope.entry;
  if (e && typeof e === "object" && !Array.isArray(e)) {
    const bk = (e as Record<string, unknown>).bundle_key;
    if (typeof bk === "string") return bk;
  }
  return scope.entryKey;
}
