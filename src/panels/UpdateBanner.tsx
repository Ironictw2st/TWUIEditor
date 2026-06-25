import { useEffect, useState } from "react";
import { checkForUpdate, installAndRelaunch, type UpdateInfo } from "../updater";
import Markdown from "../components/Markdown";

/** Checks for a newer GitHub release once on mount; if one is found, shows a small prompt to install
 *  and restart (with a download progress bar). Mounted only in the main window, production builds. */
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((u) => {
      if (!cancelled) setInfo(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || dismissed) return null;

  const install = async () => {
    setBusy(true);
    try {
      await installAndRelaunch(info, setProgress);
    } catch {
      setBusy(false); // install/relaunch failed; allow retry
    }
  };

  return (
    <div className="fixed z-50 right-3 bottom-3 w-80 rounded-lg bg-sunken border border-accent/60 shadow-xl text-[12px] p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-accent">Update available</span>
        <span className="text-textMuted">v{info.version}</span>
        <div className="flex-1" />
        {!busy && (
          <button className="text-gray-500 hover:text-text" onClick={() => setDismissed(true)} title="Later">
            ✕
          </button>
        )}
      </div>
      {info.notes && (
        <div className="text-[11px] text-textMuted max-h-24 overflow-auto mb-2">
          <Markdown text={info.notes} />
        </div>
      )}
      {busy ? (
        <div>
          <div className="h-1.5 rounded bg-button overflow-hidden">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Downloading… {Math.round(progress * 100)}%</div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1 rounded bg-accent/30 hover:bg-accent/40 border border-accent text-[11px]"
            onClick={install}
          >
            Install &amp; Restart
          </button>
          <button
            className="px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
            onClick={() => setDismissed(true)}
          >
            Later
          </button>
        </div>
      )}
    </div>
  );
}
