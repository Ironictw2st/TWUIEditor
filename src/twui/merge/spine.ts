// The merge "spine": flatten one component's below-component structure into an addressable,
// keyed list of entries. classifyComponents (diagnostics/classify.ts) only covers
// component/layoutEngine/state/image/component_image/model — the merge needs EVERY nested kind
// (localised_texts, transitions, callbacks, material overrides, animations, component_text) or
// those changes silently drop. Each entry carries a stable match key so the diff can pair A's and
// B's entries container-by-container, plus the owner guid + container tag + index needed to apply
// a granular edit through mutate.ts helpers.

import type { RawElement } from "../../types/twui";
import {
  childByTag,
  componentStates,
  elementChildren,
  getAttr,
  getLayoutEngine,
  guidOf,
  stateImages,
} from "../doc";
import type { ChangeLevel } from "./types";

/** One below-component element, flattened and keyed for diffing/applying. */
export interface SpineEntry {
  level: ChangeLevel;
  el: RawElement;
  /** Guid of the element the container hangs off — the owning component OR (for a state's images /
   *  component_text) the owning state. Null when that owner has no guid (then the entry is not
   *  granularly addressable and its parent is adopted wholesale). */
  ownerGuid: string | null;
  /** Container element tag ("states", "componentimages", …); "" for a singleton named child
   *  (LayoutEngine, component_model_view, component_text). */
  containerTag: string;
  /** Element-index within its container (0 for singletons). */
  index: number;
  /** Stable match key, unique within (ownerGuid, containerTag). */
  key: string;
}

/** Where each container's children come from and how to key them. */
type ContainerSpec = {
  level: ChangeLevel;
  containerTag: string;
  /** natural key for a child (before de-duplication); undefined ⇒ fall back to positional. */
  natural: (el: RawElement) => string | undefined;
};

const CONTAINER_SPECS: ContainerSpec[] = [
  { level: "component_image", containerTag: "componentimages", natural: (e) => guidOf(e) ?? getAttr(e, "imagepath") },
  { level: "localised_text", containerTag: "localised_texts", natural: (e) => `state:${getAttr(e, "state") ?? ""}` },
  { level: "transition", containerTag: "transitionmap", natural: (e) => getAttr(e, "index") },
  { level: "material_parameter", containerTag: "material_m_parameter_overrides", natural: (e) => getAttr(e, "name") },
  { level: "material_texture", containerTag: "material_m_texture_overrides", natural: (e) => getAttr(e, "slot_id") },
  { level: "animation", containerTag: "animations", natural: (e) => getAttr(e, "id") ?? e.tag },
];

/** Callback identity: the event + context object it fires on. Deliberately excludes
 *  context_function_id so a changed function body reads as a MODIFY (adopt B's), not a
 *  remove+add. Two callbacks sharing callback_id+object fall back to positional keys. */
function callbackKey(cb: RawElement): string | undefined {
  const id = getAttr(cb, "callback_id");
  const obj = getAttr(cb, "context_object_id");
  const parts = [id, obj].filter((p) => p !== undefined);
  return parts.length ? parts.join("|") : undefined;
}

/** Assign keys to a container's children: use the natural key, but if any natural key repeats
 *  (or is absent), fall back to a positional `#index` key for the whole container so matching
 *  between A and B stays 1:1. */
function keyChildren(children: RawElement[], natural: (el: RawElement) => string | undefined): string[] {
  const raw = children.map(natural);
  const counts = new Map<string, number>();
  for (const k of raw) if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
  return raw.map((k, i) => (k !== undefined && counts.get(k) === 1 ? k : `#${i}`));
}

function pushContainer(
  out: SpineEntry[],
  owner: RawElement,
  ownerGuid: string | null,
  spec: Pick<ContainerSpec, "level" | "containerTag"> & { natural: (el: RawElement) => string | undefined }
): void {
  const cont = childByTag(owner, spec.containerTag);
  if (!cont) return;
  const kids = elementChildren(cont);
  const keys = keyChildren(kids, spec.natural);
  kids.forEach((el, i) => {
    out.push({ level: spec.level, el, ownerGuid, containerTag: spec.containerTag, index: i, key: keys[i] });
  });
}

/**
 * Flatten one component definition into keyed spine entries covering every below-component
 * structure. Order within a container is preserved (entry.index). The component root's own
 * attributes are diffed separately (see diff.ts) — they are not spine entries.
 */
export function componentSpine(comp: RawElement): SpineEntry[] {
  const out: SpineEntry[] = [];
  const compGuid = guidOf(comp) ?? null;

  // LayoutEngine — singleton named child.
  const le = getLayoutEngine(comp);
  if (le) out.push({ level: "layoutEngine", el: le, ownerGuid: compGuid, containerTag: "", index: 0, key: "layoutEngine" });

  // States (and, per state, its image draw-layers + component_text).
  const states = componentStates(comp);
  const stateKeys = keyChildren(states, (s) => guidOf(s) ?? getAttr(s, "name"));
  states.forEach((st, si) => {
    out.push({ level: "state", el: st, ownerGuid: compGuid, containerTag: "states", index: si, key: stateKeys[si] });
    const stGuid = guidOf(st) ?? null;
    // A state's inner structures are only granularly addressable when the state has its own guid;
    // otherwise the whole state is adopted as a unit (no inner entries emitted).
    if (stGuid) {
      const images = stateImages(st);
      images.forEach((img, ii) => {
        out.push({ level: "image", el: img, ownerGuid: stGuid, containerTag: "imagemetrics", index: ii, key: `#${ii}` });
      });
      const ctext = childByTag(st, "component_text");
      if (ctext) out.push({ level: "component_text", el: ctext, ownerGuid: stGuid, containerTag: "", index: 0, key: "component_text" });
    }
  });

  // component_images.
  pushContainer(out, comp, compGuid, CONTAINER_SPECS[0]);

  // localised_texts, transitions, material overrides, animations.
  for (const spec of CONTAINER_SPECS.slice(1)) pushContainer(out, comp, compGuid, spec);

  // Callbacks (inline list OR templated list — read whichever exists).
  for (const tag of ["callbackwithcontextlist", "callbacks_with_context"]) {
    const cont = childByTag(comp, tag);
    if (!cont) continue;
    const cbs = elementChildren(cont).filter((c) => c.tag === "callback_with_context");
    const keys = keyChildren(cbs, callbackKey);
    cbs.forEach((cb, i) => {
      out.push({ level: "callback", el: cb, ownerGuid: compGuid, containerTag: tag, index: i, key: keys[i] });
    });
  }

  // component_model_view — treated as a singleton named child (adopt-whole; WH3/142, rare).
  const mv = childByTag(comp, "component_model_view");
  if (mv) out.push({ level: "model", el: mv, ownerGuid: compGuid, containerTag: "", index: 0, key: "component_model_view" });

  return out;
}
