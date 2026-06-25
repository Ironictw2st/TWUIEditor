// Opt-in, user-triggered conversion of a layout between format versions. This is a
// deliberate, explicit transform that DOES change bytes — distinct from the editor's sacred
// edit->save byte-identical round-trip. It never runs on load/save; only when the user asks.
//
// Scope: the only schema break across the supported versions (135/136 -> 142) is the WH3 jump.
// The mapping below is intentionally conservative and declarative — it encodes exactly the
// renames/removals proven by diffing the bundled 3K (135/136) and WH3 (142) files.

import { isElement, RawElement, TwuiDocument } from "../types/twui";
import { getAttr, removeAttr, setAttr } from "./doc";

/** Attributes dropped entirely at 142. A downgrade cannot restore them (the data is gone),
 *  so it simply leaves them absent. */
const REMOVED_AT_142 = [
  "font_m_tracking",
  "canuse1bitalpha",
  "matchfontsizes",
  "renderwhendragged",
  "renderlastonfocused",
];

/** Elements dropped entirely at 142. */
const REMOVED_ELEMENTS_AT_142 = new Set(["localisation_changes"]);

export interface MigrationResult {
  from: number;
  to: number;
  /** Attributes renamed (e.g. isaspectratiolocked -> aspect_ratio_locked_behaviour). */
  renamed: number;
  /** Attributes removed (dropped-at-142 set, plus isaspectratiolocked="false"). */
  removed: number;
  /** Whole elements removed (e.g. <localisation_changes/>). */
  elementsRemoved: number;
  /** Whether anything actually changed (besides the version stamp). */
  changed: boolean;
}

function walk(el: RawElement, visit: (e: RawElement) => void): void {
  visit(el);
  for (const c of el.children) if (isElement(c)) walk(c, visit);
}

/** Convert `doc` (in place) to `target` version, returning a summary of what changed. Safe to
 *  run inside the store's `mutate` (which snapshots for undo). Use `previewMigration` for a
 *  dry run that reports the same counts without touching the document. */
export function migrateLayout(doc: TwuiDocument, target: number): MigrationResult {
  const from = parseInt(getAttr(doc.root, "version") ?? "0", 10) || 0;
  const res: MigrationResult = { from, to: target, renamed: 0, removed: 0, elementsRemoved: 0, changed: false };
  const upgrade = from < 142 && target >= 142;
  const downgrade = from >= 142 && target < 142;

  walk(doc.root, (el) => {
    if (upgrade) {
      const lock = getAttr(el, "isaspectratiolocked");
      if (lock !== undefined) {
        removeAttr(el, "isaspectratiolocked");
        if (lock === "true") {
          // 142 default behaviour for a locked element is "Width First" (dominant in the files).
          setAttr(el, "aspect_ratio_locked_behaviour", "Width First");
          res.renamed++;
        } else {
          res.removed++; // unlocked => no attr in 142 (unlocked is the default)
        }
      }
      for (const a of REMOVED_AT_142) {
        if (getAttr(el, a) !== undefined) {
          removeAttr(el, a);
          res.removed++;
        }
      }
      const before = el.children.length;
      el.children = el.children.filter((c) => !(isElement(c) && REMOVED_ELEMENTS_AT_142.has(c.tag)));
      res.elementsRemoved += before - el.children.length;
    } else if (downgrade) {
      const beh = getAttr(el, "aspect_ratio_locked_behaviour");
      if (beh !== undefined) {
        // Any 142 lock behaviour maps back to the old boolean "locked". A previously-unlocked
        // element carried no attr in 142, so it correctly stays unlocked (absent) here.
        removeAttr(el, "aspect_ratio_locked_behaviour");
        setAttr(el, "isaspectratiolocked", "true");
        res.renamed++;
      }
    }
  });

  res.changed = res.renamed > 0 || res.removed > 0 || res.elementsRemoved > 0 || from !== target;
  setAttr(doc.root, "version", String(target));
  return res;
}

/** Dry run: report what `migrateLayout(doc, target)` would change, without mutating `doc`. */
export function previewMigration(doc: TwuiDocument, target: number): MigrationResult {
  const clone: TwuiDocument = JSON.parse(JSON.stringify(doc));
  return migrateLayout(clone, target);
}

/** Human-readable one-liner for a confirm dialog. */
export function describeMigration(r: MigrationResult): string {
  const parts: string[] = [];
  if (r.renamed) parts.push(`${r.renamed} attribute${r.renamed === 1 ? "" : "s"} renamed`);
  if (r.removed) parts.push(`${r.removed} attribute${r.removed === 1 ? "" : "s"} removed`);
  if (r.elementsRemoved) parts.push(`${r.elementsRemoved} element${r.elementsRemoved === 1 ? "" : "s"} removed`);
  const body = parts.length ? parts.join(", ") : "no attribute/element changes";
  return `Convert layout v${r.from} -> v${r.to}: ${body}. The version stamp is updated and the file's bytes will change.`;
}
