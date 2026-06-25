import { useState } from "react";
import Markdown from "../components/Markdown";
import twuiVersions from "../docs/twui-versions.md?raw";

// Reference documentation shown in a modal (toolbar "Docs"). Each entry is a markdown file in
// src/docs/ rendered via the Markdown component — add a new `{ id, label, body }` to extend.
interface Doc {
  id: string;
  label: string;
  body: string;
}

const DOCS: Doc[] = [{ id: "versions", label: "TWUI Versions", body: twuiVersions }];

const btn = "px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[12px]";

export default function DocsPanel({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(DOCS[0]?.id ?? "");
  const doc = DOCS.find((d) => d.id === active) ?? DOCS[0];
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-12 -translate-x-1/2 w-[820px] max-h-[82vh] flex flex-col bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-2 border-b border-edge bg-panelHeader">
          <span className="font-semibold">Docs</span>
          <div className="flex-1" />
          <button className={btn} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="w-44 shrink-0 border-r border-edge py-2">
            {DOCS.map((d) => (
              <button
                key={d.id}
                className={`w-full text-left px-3 py-1.5 text-[12px] ${
                  active === d.id
                    ? "bg-accent/20 text-accent border-l-2 border-accent"
                    : "text-text hover:bg-panelAlt border-l-2 border-transparent"
                }`}
                onClick={() => setActive(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-auto p-4 leading-relaxed">
            {doc ? <Markdown text={doc.body} /> : <div className="text-textMuted">No documents.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
