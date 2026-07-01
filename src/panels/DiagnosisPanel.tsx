import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { componentMap, getAttr } from "../twui/doc";
import { runDiagnostics } from "../twui/diagnostics";
import type { Diagnostic, Severity } from "../twui/diagnostics";
import type { RawElement } from "../types/twui";

const SEV_DOT: Record<Severity, string> = {
  error: "bg-red-500",
  warning: "bg-amber-300/80",
  info: "bg-sky-400",
};
const SEV_LABEL: Record<Severity, string> = {
  error: "Errors",
  warning: "Warnings",
  info: "Info",
};

/** One severity group (Errors / Warnings / Info) with its clickable rows. */
function Group({
  sev,
  list,
  labelFor,
  onSelect,
}: {
  sev: Severity;
  list: Diagnostic[];
  labelFor: (g: string | null) => string;
  onSelect: (guid: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-edge/60">
      <div
        className="px-2 py-1 flex items-center gap-2 cursor-pointer bg-panelHeader hover:bg-panelAlt select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-gray-500 text-[10px]">{open ? "▾" : "▸"}</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[sev]}`} />
        <span className="text-[11px] font-medium">{SEV_LABEL[sev]}</span>
        <span className="text-textMuted">({list.length})</span>
      </div>
      {open &&
        list.map((d, i) => (
          <div
            key={`${d.ruleId}:${d.guid ?? ""}:${d.attr ?? ""}:${i}`}
            role="button"
            onClick={() => d.guid && onSelect(d.guid)}
            title={d.guid ? "Select the affected component in the Hierarchy" : undefined}
            className={`flex items-center gap-1.5 pl-7 pr-2 py-1 border-b border-edge/40 ${
              d.guid ? "cursor-pointer hover:bg-panelHeader" : "cursor-default"
            }`}
          >
            <span className="flex-1 min-w-0 truncate text-text">{d.message}</span>
            <span className="shrink-0 text-textMuted/80 truncate max-w-[45%]">{labelFor(d.guid)}</span>
          </div>
        ))}
    </div>
  );
}

/** Read-only integrity diagnostics for the open document. Runs the full rule pass
 *  on open, on tab switch, and on Refresh (NOT per keystroke — the toolbar badge
 *  covers live cheap checks). Clicking a row focuses the affected node. */
export default function DiagnosisPanel() {
  const doc = useStore((s) => s.doc);
  const activeTabId = useStore((s) => s.activeTabId);
  const select = useStore((s) => s.select);
  const [results, setResults] = useState<Diagnostic[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setResults(doc ? runDiagnostics(doc) : []);
    // Intentionally not keyed on `doc`: re-run on open / tab switch / Refresh only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, nonce]);

  const compMap = useMemo<Map<string, RawElement>>(() => (doc ? componentMap(doc) : new Map()), [doc]);
  const labelFor = (g: string | null): string => {
    if (!g) return "document";
    const el = compMap.get(g);
    return el ? (getAttr(el, "id") ?? el.tag) : g.slice(0, 8);
  };

  const errs = results.filter((d) => d.severity === "error");
  const warns = results.filter((d) => d.severity === "warning");
  const infos = results.filter((d) => d.severity === "info");
  const groups: [Severity, Diagnostic[]][] = [
    ["error", errs],
    ["warning", warns],
    ["info", infos],
  ];

  return (
    <div className="flex flex-col h-full text-[11px]">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-edge shrink-0">
        <span className="font-medium text-[12px]">Diagnosis</span>
        <span className="text-textMuted">
          {errs.length} error{errs.length === 1 ? "" : "s"} · {warns.length} warning{warns.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <button
          className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
          onClick={() => setNonce((n) => n + 1)}
          title="Re-run the full integrity pass"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {!doc ? (
          <div className="px-3 py-2 text-textMuted">Open a .twui.xml file to begin.</div>
        ) : results.length === 0 ? (
          <div className="px-3 py-2 text-textMuted flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            No integrity issues found.
          </div>
        ) : (
          groups.map(
            ([sev, list]) =>
              list.length > 0 && (
                <Group key={sev} sev={sev} list={list} labelFor={labelFor} onSelect={select} />
              ),
          )
        )}
      </div>
    </div>
  );
}
