// Generic widget detection for the visualizer's Simulation mode: which
// components are interactive, tab/button groups, and which states represent a
// "pressed/active" look for click feedback. Driven by the panel's own callbacks
// (no panel-specific code).

import { RawElement, TwuiDocument } from "../types/twui";
import {
  ancestorGuids,
  componentMap,
  componentStates,
  elementChildren,
  getAttr,
  guidOf,
  hierarchyRoot,
} from "./doc";
import { callbacks } from "./cco";

const INTERACTIVE = new Set([
  "Button",
  "ButtonGroupPanelSelector",
  "ContextButtonGroupButtonSelector",
  "ContextCommandLeftClick",
]);

/** True if the component has a click/button callback. */
export function isInteractive(comp: RawElement): boolean {
  return callbacks(comp).some((c) => INTERACTIVE.has(c.id));
}

function findNode(root: RawElement, guid: string): RawElement | undefined {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (guidOf(n) === guid) return n;
    for (const c of elementChildren(n)) stack.push(c);
  }
  return undefined;
}

export interface ButtonGroupHit {
  groupGuid: string;
  buttonGuid: string;
  buttonIndex: number;
  buttons: string[];
  panels: string[];
}

/**
 * If `guid` sits inside a `ButtonGroupPanelSelector` group, return the group's
 * buttons, the clicked button's index, and the tab panels it controls.
 * Tab panels are detected by the `tab_*` naming convention (best-effort — the
 * XML doesn't encode the button→panel mapping explicitly).
 */
export function buttonGroup(doc: TwuiDocument, guid: string): ButtonGroupHit | null {
  const root = hierarchyRoot(doc);
  if (!root) return null;
  const comps = componentMap(doc);
  const hasSelector = (g: string) => {
    const c = comps.get(g);
    return !!c && callbacks(c).some((cb) => cb.id === "ButtonGroupPanelSelector");
  };
  const chain = ancestorGuids(doc, guid); // [root, …, parent]
  let groupGuid: string | undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (hasSelector(chain[i])) {
      groupGuid = chain[i];
      break;
    }
  }
  if (!groupGuid) return null;
  const groupNode = findNode(root, groupGuid);
  if (!groupNode) return null;
  const buttonNodes = elementChildren(groupNode);
  const buttons = buttonNodes.map((b) => guidOf(b) ?? "");
  const buttonIndex = buttonNodes.findIndex(
    (b) => guidOf(b) === guid || !!findNode(b, guid)
  );
  if (buttonIndex < 0) return null;
  return { groupGuid, buttonGuid: buttons[buttonIndex], buttonIndex, buttons, panels: findTabPanels(root, buttons.length) };
}

/** First sibling group of `>= n` `tab_*` containers (excluding the button bar). */
function findTabPanels(root: RawElement, n: number): string[] {
  const isPanel = (tag: string) => /^tab_/i.test(tag) && !/^tab_button/i.test(tag);
  let result: string[] = [];
  const visit = (node: RawElement): boolean => {
    const panels = elementChildren(node)
      .filter((c) => isPanel(c.tag))
      .map((c) => guidOf(c) ?? "");
    if (panels.length >= n) {
      result = panels.slice(0, n);
      return true;
    }
    for (const c of elementChildren(node)) if (visit(c)) return true;
    return false;
  };
  visit(root);
  return result;
}

/** The interactive component at/above `guid` (the clicked node or a button ancestor). */
export function interactiveTarget(doc: TwuiDocument, guid: string): string | null {
  const comps = componentMap(doc);
  const self = comps.get(guid);
  if (self && isInteractive(self)) return guid;
  const chain = ancestorGuids(doc, guid);
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = comps.get(chain[i]);
    if (c && isInteractive(c)) return chain[i];
  }
  return null;
}

/** State names that represent a pressed/active look (for click feedback). */
export function clickableStates(comp: RawElement): string[] {
  return componentStates(comp)
    .map((s) => getAttr(s, "name") ?? "")
    .filter((nm) => /active|selected|down|hover|^on$/i.test(nm));
}
