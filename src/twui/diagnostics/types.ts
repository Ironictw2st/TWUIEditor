// Types for the diagnostics engine — a rule registry that surfaces integrity
// problems in the open TWUI document. Everything is derived from the in-memory
// doc; nothing here mutates it (the feature is strictly read-only / advisory).

import type { TwuiDocument, RawElement } from "../../types/twui";
import type { AttrKind } from "../schema";

export type Severity = "error" | "warning" | "info";

/** Cheap rules run on every (debounced) edit to drive the live badge; expensive
 *  rules run only in the full panel pass (on open / Refresh / tab switch). */
export type RuleCost = "cheap" | "expensive";

/** One detected problem. `guid` is the node to focus when the row is clicked
 *  (via `select(guid)`); null means a document-level issue with no single node. */
export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  guid: string | null;
  attr?: string;
}

/** An element from the <components> section tagged with its schema `kind`.
 *  Kind is structural (a component tag is component-named, never literally
 *  "component"), so it is resolved once by the walk in classify.ts and shared. */
export interface ClassifiedEl {
  el: RawElement;
  kind: AttrKind;
  /** The element's own `this`, else the owning component's guid (LayoutEngine /
   *  model elements carry no guid, so diagnostics on them target the component). */
  guid: string | null;
  comp: RawElement;
  compGuid: string | null;
  /** Owning component has part_of_template="true" — its states/images/dimensions
   *  resolve in the template file, so local reference rules skip it. */
  templated: boolean;
}

/** Pre-computed context built once per pass and handed to every rule. */
export interface DiagContext {
  doc: TwuiDocument;
  version: number;
  compMap: Map<string, RawElement>;
  /** Every `this` GUID found in the <hierarchy> subtree. */
  hierGuids: Set<string>;
  classified: ClassifiedEl[];
}

export interface Rule {
  id: string;
  title: string;
  cost: RuleCost;
  defaultSeverity: Severity;
  run(ctx: DiagContext): Diagnostic[];
}
