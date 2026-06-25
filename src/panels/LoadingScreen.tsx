import { useStore } from "../state/store";
import logoUrl from "../assets/logo.svg";

/** Full-screen boot overlay shown until the initial `init()` finishes loading all
 *  game data (db/loc/packs/templates). Mirrors the static `.boot` splash in
 *  index.html so there's no flash between them. */
export default function LoadingScreen() {
  const status = useStore((s) => s.status);
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-canvas">
      <img src={logoUrl} width={72} height={72} className="rounded-xl" alt="" />
      <div className="w-7 h-7 rounded-full border-[3px] border-edge border-t-accent animate-spin" />
      <div className="text-[13px] font-semibold tracking-wide text-accent">TWUI Editor</div>
      <div className="text-[11px] text-textMuted max-w-[420px] truncate px-4 text-center">
        {status || "Loading game data…"}
      </div>
    </div>
  );
}
