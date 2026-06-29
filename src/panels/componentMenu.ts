import { useStore } from "../state/store";
import { sameHierarchyParent } from "../twui/mutate";
import type { MenuItem } from "../components/ContextMenu";

/** The right-click menu for a single component, shared by the Hierarchy tree and the canvas so
 *  the two never drift. Delete/Duplicate/Copy/Paste act on the current selection, so the caller
 *  must select `guid` first (both call sites do). `hidden` controls the Show/Hide label. */
export function buildComponentMenu(guid: string, opts: { hidden: boolean }): MenuItem[] {
  const s = useStore.getState();
  const sel = s.selectedGuids;
  const canSwap = sel.length === 2 && !!s.doc && sameHierarchyParent(s.doc, sel[0], sel[1]);
  return [
    { label: "Duplicate", onSelect: () => s.duplicateSelected() },
    { label: "Delete", danger: true, onSelect: () => s.deleteSelected() },
    ...(canSwap
      ? [
          { label: "", separator: true },
          { label: "Swap positions", onSelect: () => s.swapSelectedOffsets() },
        ]
      : []),
    { label: "", separator: true },
    { label: opts.hidden ? "Show" : "Hide", onSelect: () => s.toggleVisible(guid) },
    { label: "", separator: true },
    { label: "Copy", onSelect: () => s.copy() },
    { label: "Paste", onSelect: () => s.paste() },
    { label: "", separator: true },
    {
      label: "Regenerate GUIDs",
      submenu: [
        { label: "This component", onSelect: () => s.regenComponentGuids(guid) },
        { label: "Including children", onSelect: () => s.regenSubtreeGuids(guid) },
      ],
    },
  ];
}
