// Inline type-aware autocomplete for CCO expression fields. `useExprAutocomplete` attaches
// to a text field: it detects the ref-chain under the caret, resolves its type from the docs,
// and shows a caret-anchored suggestion popover with keyboard nav (modeled on SearchPalette).
// The field composes the returned handlers; when the popover is open it consumes Arrow/Enter/
// Tab/Escape (preventDefault), so the field checks `e.defaultPrevented` before its own keys.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CcoDocs } from "../types/twui";
import { splitDots } from "../twui/cco";
import { caretChain, caretCoordinates, CaretChain } from "../twui/cco_caret";
import { Completion, memberCompletions, resolveChainType, rootCompletions } from "../twui/cco_types";

type FieldEl = HTMLTextAreaElement | HTMLInputElement;

export interface AutocompleteCtx {
  docs: CcoDocs | null;
  /** Receiver type for `self`/`this`/bare roots — the callback's context_object_id. */
  selfType?: string;
}

export interface ExprAutocomplete {
  popover: ReactNode;
  onChange: (e: React.ChangeEvent<FieldEl>) => void;
  onKeyDown: (e: React.KeyboardEvent<FieldEl>) => void;
  onBlur: () => void;
}

export function useExprAutocomplete<T extends FieldEl>(
  ref: React.RefObject<T | null>,
  ctx: AutocompleteCtx,
  value: string,
  setLocal: (next: string) => void
): ExprAutocomplete {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Completion[]>([]);
  const [hi, setHi] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number; height: number } | null>(null);
  const cc = useRef<CaretChain | null>(null);

  const compute = useCallback(
    (val: string, caret: number, shouldOpen: boolean) => {
      const c = caretChain(val, caret);
      if (!c) return setOpen(false);
      const list = c.atRoot
        ? rootCompletions(c.prefix, ctx)
        : memberCompletions(resolveChainType(splitDots(c.chain), ctx).type, c.prefix, ctx);
      if (list.length === 0 || (!shouldOpen && !open)) return setOpen(false);
      cc.current = c;
      setItems(list.slice(0, 50));
      setHi(0);
      const el = ref.current;
      if (el) setCoords(caretCoordinates(el, caret));
      setOpen(true);
    },
    [ctx, open, ref]
  );

  const accept = useCallback(
    (item: Completion) => {
      const el = ref.current;
      const c = cc.current;
      if (!el || !c) return;
      const next = value.slice(0, c.start) + item.name + value.slice(c.end);
      const caret = c.start + item.name.length;
      setLocal(next);
      setOpen(false);
      requestAnimationFrame(() => {
        const e2 = ref.current;
        if (!e2) return;
        e2.focus();
        e2.setSelectionRange(caret, caret);
      });
    },
    [ref, setLocal, value]
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<FieldEl>) => {
      const el = e.currentTarget;
      const val = el.value;
      const caret = el.selectionStart ?? val.length;
      setLocal(val);
      compute(val, caret, val[caret - 1] === ".");
    },
    [compute, setLocal]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<FieldEl>) => {
      if (open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          setHi((h) => Math.min(items.length - 1, h + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          setHi((h) => Math.max(0, h - 1));
        } else if ((e.key === "Enter" || e.key === "Tab") && items[hi]) {
          e.preventDefault();
          e.stopPropagation();
          accept(items[hi]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        return;
      }
      // On-demand open with Ctrl+Space.
      if (e.key === " " && e.ctrlKey) {
        e.preventDefault();
        const el = ref.current;
        if (el) compute(el.value, el.selectionStart ?? el.value.length, true);
      }
    },
    [open, items, hi, accept, compute, ref]
  );

  const onBlur = useCallback(() => setOpen(false), []);

  const popover =
    open && coords
      ? createPortal(
          <div
            className="fixed z-50 max-h-64 w-72 overflow-auto bg-panel border border-edge rounded shadow-xl text-[11px]"
            style={{ top: coords.top, left: coords.left }}
          >
            {items.map((it, i) => (
              <div
                key={it.name}
                className={`px-2 py-1 cursor-pointer ${i === hi ? "bg-accent/20" : "hover:bg-panelHeader"}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep field focus so the pick lands before blur
                  accept(it);
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-text truncate">{it.name}</span>
                  {it.ret && (
                    <span className="text-[10px] text-textMuted shrink-0">
                      → {it.ret}
                      {it.list ? " (list)" : ""}
                    </span>
                  )}
                </div>
                {it.desc && <div className="text-[10px] text-gray-600 truncate">{it.desc}</div>}
              </div>
            ))}
          </div>,
          document.body
        )
      : null;

  return { popover, onChange, onKeyDown, onBlur };
}
