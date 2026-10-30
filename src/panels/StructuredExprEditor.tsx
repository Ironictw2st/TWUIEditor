// Per-line editable rendering of a broken-out CCO condition. The AND/OR/lambda structure is
// preserved (re-derived from the parsed tree, never typed); the user edits each leaf/binding
// as its own inline field with type-aware autocomplete. On blur, if any field changed, the
// tree is re-serialized to a compact TWUI string and committed — an untouched editor never
// writes, so an unedited expression stays byte-identical.

import { useEffect, useMemo, useRef, useState } from "react";
import { CcoDocs } from "../types/twui";
import {
  ExprLine,
  applyLeafEdits,
  editModel,
  parseExprTree,
  serializeExpr,
  splitComponentRefs,
} from "../twui/cco_format";
import { useExprAutocomplete } from "./ExprAutocomplete";

export function StructuredExprEditor({
  expr,
  resolve,
  selfType,
  docs,
  onCommit,
}: {
  expr: string;
  resolve?: (g: string) => string | undefined;
  selfType?: string;
  docs: CcoDocs | null;
  onCommit: (compactDecoded: string) => void;
}) {
  const tree = useMemo(() => parseExprTree(expr), [expr]);
  const model = useMemo(() => editModel(tree), [tree]);
  const [texts, setTexts] = useState<string[]>(model.texts);
  // Re-seed drafts when the underlying expression/row changes.
  useEffect(() => setTexts(model.texts), [expr]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAt = (i: number, v: string) => setTexts((t) => t.map((x, j) => (j === i ? v : x)));

  const commit = () => {
    if (!texts.some((t, i) => t !== model.texts[i])) return; // unchanged → no write
    const out = serializeExpr(applyLeafEdits(tree, texts));
    if (out !== expr) onCommit(out);
  };

  return (
    <div className="font-mono text-[10px] leading-snug bg-codebg border border-edge rounded px-2 py-1 mb-1">
      {model.lines.map((ln, i) => (
        <ExprLineField
          key={i}
          line={ln}
          value={texts[i] ?? ""}
          onChange={(v) => setAt(i, v)}
          onCommit={commit}
          resolve={resolve}
          docs={docs}
          selfType={selfType}
        />
      ))}
    </div>
  );
}

function ExprLineField({
  line,
  value,
  onChange,
  onCommit,
  resolve,
  docs,
  selfType,
}: {
  line: ExprLine;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  resolve?: (g: string) => string | undefined;
  docs: CcoDocs | null;
  selfType?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const ac = useExprAutocomplete(ref, { docs, selfType }, value, onChange);
  const rows = Math.min(6, Math.max(1, Math.ceil(value.length / 48)));

  // Read-only resolved-id chips for any Component("<guid>") the leaf references.
  const chips: string[] = [];
  if (resolve) {
    for (const s of splitComponentRefs(value)) {
      if (s.kind === "ref") {
        const id = resolve(s.guid);
        if (id) chips.push(id);
      }
    }
  }

  return (
    <div className="flex" style={{ paddingLeft: line.depth * 12 }}>
      <span
        className={`shrink-0 w-9 pr-1 text-right select-none ${
          line.binding ? "text-textMuted" : "font-bold text-accent/80"
        }`}
      >
        {line.binding ? "let" : line.connective ?? ""}
      </span>
      <div className="min-w-0 flex-1">
        <textarea
          ref={ref}
          className="w-full resize-none bg-transparent text-text outline-none border-b border-transparent focus:border-edge"
          rows={rows}
          spellCheck={false}
          value={value}
          onChange={ac.onChange}
          onKeyDown={(e) => {
            ac.onKeyDown(e);
            if (e.defaultPrevented) return;
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            ac.onBlur();
            onCommit();
          }}
        />
        {chips.length > 0 && (
          <div className="text-[10px] text-textMuted select-none">
            {chips.map((c, k) => (
              <span key={k} className="mr-2">
                → {c}
              </span>
            ))}
          </div>
        )}
        {ac.popover}
      </div>
    </div>
  );
}
