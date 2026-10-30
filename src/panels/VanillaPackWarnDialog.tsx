import { useEffect } from "react";
import { useStore } from "../state/store";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Blocking warning shown when the user tries to write a layout into an official Creative Assembly
 * (vanilla) pack — any pack whose PFH type isn't "Mod". Rendered by App only while `vanillaGuard`
 * is set. The only way to allow such writes is the Settings → Editor toggle; this popup never
 * bypasses it (it just offers Cancel and, for a save, a Save As… redirect).
 */
export default function VanillaPackWarnDialog() {
  const guard = useStore((s) => s.vanillaGuard);
  const packType = useStore((s) => s.workspacePackType);
  const packName = useStore((s) => s.workspacePack);
  const close = useStore((s) => s.closeVanillaGuard);
  const saveAsDialog = useStore((s) => s.saveAsDialog);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!guard) return null;

  const kindWord = guard.action === "delete" ? "delete from" : guard.action === "create" ? "add to" : "save into";
  const packLabel = packName ? baseName(packName) : "this pack";
  const typeLabel = packType ?? "vanilla";

  const saveAs = () => {
    close();
    void saveAsDialog();
  };

  const btn = "px-3 py-1.5 rounded border border-edge text-[12px]";
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="w-[440px] rounded-lg bg-panel border border-edge shadow-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] font-medium text-text mb-2">Cannot {kindWord} a vanilla pack</div>
        <div className="text-[12px] text-textMuted leading-relaxed mb-4">
          <span className="text-text">{packLabel}</span> is a{" "}
          <span className="text-amber-300">{typeLabel}</span> pack — an official Creative Assembly game
          file. Writing to it can corrupt your game install, so the editor blocks it by default.
          <br />
          <br />
          To allow this, enable <span className="text-text">Settings → Editor → “Allow saving into
          vanilla packs”</span>. Otherwise, save your changes into a mod pack or a loose file instead.
        </div>

        <div className="flex justify-end gap-2">
          <button className={`${btn} text-textMuted hover:bg-button`} onClick={close}>
            Cancel
          </button>
          {guard.action === "save" && (
            <button className={`${btn} bg-accent/25 text-accent ring-1 ring-accent/50`} onClick={saveAs}>
              Save As…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
