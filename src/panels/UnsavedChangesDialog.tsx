import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../state/store";

type Choice = "save" | "saveAs" | "discard" | "cancel";

/** Modal shown when unsaved edits would be lost — by closing a dirty tab (`pendingCloseTab`)
 *  or closing the window (`pendingClose`). Save / Save As… / Don't Save / Cancel. */
export default function UnsavedChangesDialog() {
  const pendingClose = useStore((s) => s.pendingClose);
  const pendingCloseTab = useStore((s) => s.pendingCloseTab);
  const tabs = useStore((s) => s.tabs);
  const fileName = useStore((s) => s.fileName);
  const confirmClose = useStore((s) => s.confirmClose);
  const confirmCloseTab = useStore((s) => s.confirmCloseTab);

  const closing = pendingClose;
  const active = closing || pendingCloseTab != null;

  // Name shown in the prompt: the tab being closed, else the active file (window close).
  const tabName = pendingCloseTab ? tabs.find((t) => t.id === pendingCloseTab)?.fileName : null;
  const name = tabName ?? fileName;
  const dirtyCount = tabs.filter((t) => t.dirty).length;

  const choose = async (choice: Choice) => {
    if (closing) {
      const shouldClose = await confirmClose(choice);
      if (shouldClose) await getCurrentWindow().destroy();
    } else {
      await confirmCloseTab(choice);
    }
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void choose("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, closing]);

  if (!active) return null;

  // On window close with several dirty files, name the count rather than one file.
  const message =
    closing && dirtyCount > 1
      ? `${dirtyCount} open files have unsaved changes.`
      : name
        ? `"${name}" has unsaved changes.`
        : "You have unsaved changes.";

  const btn = "px-3 py-1.5 rounded border border-edge text-[12px]";
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50"
      onClick={() => void choose("cancel")}
    >
      <div
        className="w-[420px] rounded-lg bg-panel border border-edge shadow-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] font-medium text-text mb-1">Unsaved changes</div>
        <div className="text-[12px] text-textMuted mb-4">
          {message} {closing ? "Save before closing?" : "Save before closing this tab?"}
        </div>
        <div className="flex justify-end gap-2">
          <button className={`${btn} text-textMuted hover:bg-button`} onClick={() => void choose("cancel")}>
            Cancel
          </button>
          <button className={`${btn} text-amber-300 hover:bg-button`} onClick={() => void choose("discard")}>
            Don't Save
          </button>
          <button className={`${btn} bg-button hover:bg-buttonHover`} onClick={() => void choose("saveAs")}>
            Save As…
          </button>
          <button
            className={`${btn} bg-accent/25 text-accent ring-1 ring-accent/50`}
            onClick={() => void choose("save")}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
