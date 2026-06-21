import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";
import {
  componentImages,
  componentMap,
  componentStates,
  getAttr,
  guidOf,
} from "../twui/doc";
import { componentScriptId } from "../twui/script";
import { inheritedContexts, Inheritance, representativeScope } from "../twui/inherit";
import {
  callbacks,
  evalCondition,
  evalExpr,
  evalImageSetter,
  evalTextLabel,
  listSource,
  Scope,
  toEntries,
} from "../twui/cco";
import { extractDataPack, LuaValue } from "../twui/lua";
import { bindingHint } from "../twui/cco_docs";
import { shorthandHint } from "../twui/cco_shorthand";
import { componentCreatorLayout } from "../twui/creator";
import { AttrKind, attrsFor, DOCKING_VALUES, schemaFor, validateAttr } from "../twui/schema";
import { locateHier } from "../twui/mutate";
import { RawElement, TwuiDocument } from "../types/twui";
import { imageUrl, parseElement, serializeElement } from "../ipc/commands";

/** Controlled text field that commits to the store on blur / Enter only. */
function Field({
  guid,
  attrKey,
  value,
  label,
  width,
}: {
  guid: string;
  attrKey: string;
  value: string | undefined;
  label?: string;
  width?: string;
}) {
  const editAttr = useStore((s) => s.editAttr);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value, guid]);

  const commit = () => {
    if (local !== (value ?? "")) editAttr(guid, attrKey, local);
  };

  return (
    <label className="flex items-center gap-2 mb-1">
      {label && <span className="text-gray-400 text-[11px] w-28 shrink-0">{label}</span>}
      <input
        className="flex-1"
        style={{ width }}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/** Render an ARGB hex8 (`#AARRGGBB`) — or plain `#RRGGBB` — as a CSS colour for the swatch. */
function cssColour(v: string): string {
  const t = v.trim();
  const m8 = /^#([0-9a-fA-F]{8})$/.exec(t);
  if (m8) {
    const h = m8[1];
    const a = parseInt(h.slice(0, 2), 16) / 255;
    return `rgba(${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${parseInt(h.slice(6, 8), 16)},${a})`;
  }
  return /^#([0-9a-fA-F]{6})$/.test(t) ? t : "transparent";
}

const LABEL_CLS = "text-gray-400 text-[11px] w-28 shrink-0";

/** Schema-driven attribute field: picks the control (enum/bool/colour/number/vec2/text)
 *  from the TWUI attribute schema, with a description tooltip, default placeholder, and
 *  an advisory validation hint. Falls back to a plain text Field for unknown attributes. */
function SchemaField({
  guid,
  attrKey,
  value,
  kind,
  label,
}: {
  guid: string;
  attrKey: string;
  value: string | undefined;
  kind: AttrKind;
  label?: string;
}) {
  const editAttr = useStore((s) => s.editAttr);
  const schema = schemaFor(attrKey, kind);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value, guid]);

  if (!schema) return <Field guid={guid} attrKey={attrKey} value={value} label={label ?? attrKey} />;

  const commit = () => {
    if (local !== (value ?? "")) editAttr(guid, attrKey, local);
  };
  const title = schema.description + (schema.default ? `  (default: ${schema.default})` : "");
  const labelEl = (
    <span className={LABEL_CLS} title={title}>
      {label ?? schema.label}
    </span>
  );
  const warn = validateAttr(schema, local);
  const warnEl = warn ? <div className="text-[10px] text-amber-400 mt-0.5 pl-[120px]">{warn}</div> : null;

  if (schema.type === "enum" || schema.type === "bool") {
    const opts = schema.enumValues ?? [];
    const withCurrent = local && !opts.includes(local) ? [local, ...opts] : opts;
    return (
      <label className="flex items-center gap-2 mb-1">
        {labelEl}
        <select
          className="flex-1"
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            editAttr(guid, attrKey, e.target.value);
          }}
        >
          {!local && <option value="" />}
          {withCurrent.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="mb-1">
      <label className="flex items-center gap-2">
        {labelEl}
        {schema.type === "colour" && (
          <span
            className="w-4 h-4 rounded border border-edge shrink-0"
            style={{ background: cssColour(local) }}
          />
        )}
        <input
          className="flex-1"
          value={local}
          placeholder={schema.default}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      {warnEl}
    </div>
  );
}

/** `Add…` dropdown: lists known schema attributes for `kind` that aren't already on the
 *  element; choosing one writes its default so the new field appears. */
function AddAttr({ guid, kind, present }: { guid: string; kind: AttrKind; present: string[] }) {
  const editAttr = useStore((s) => s.editAttr);
  const missing = attrsFor(kind).filter((s) => !present.includes(s.name));
  if (!missing.length) return null;
  return (
    <label className="flex items-center gap-2 mt-1.5">
      <span className="text-gray-500 text-[10px] w-28 shrink-0">add attribute</span>
      <select
        className="flex-1 text-[11px]"
        value=""
        onChange={(e) => {
          const name = e.target.value;
          if (name) editAttr(guid, name, schemaFor(name, kind)?.default ?? "");
        }}
      >
        <option value="">Add…</option>
        {missing.map((s) => (
          <option key={s.name} value={s.name} title={s.description}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DockingField({ guid, comp }: { guid: string; comp: RawElement }) {
  const editAttr = useStore((s) => s.editAttr);
  // The layout engine resolves position as `docking ?? dock_point` (templated
  // instances dock via `dock_point`, regular components via `docking`). Mirror
  // that here so a `dock_point`-only component reads cleanly, and edit whichever
  // attribute is actually in play instead of silently writing a `docking` it lacks.
  const docking = getAttr(comp, "docking");
  const dockPoint = getAttr(comp, "dock_point");
  const attrKey = docking === undefined && dockPoint !== undefined ? "dock_point" : "docking";
  const value = docking ?? dockPoint ?? "None";
  return (
    <label className="flex items-center gap-2 mb-1">
      <span className={LABEL_CLS} title={schemaFor(attrKey, "component")?.description}>
        {attrKey === "dock_point" ? "dock point" : "docking"}
      </span>
      <select
        className="flex-1"
        value={value}
        onChange={(e) => editAttr(guid, attrKey, e.target.value)}
      >
        {DOCKING_VALUES.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-edge">
      <div
        className="px-3 py-1.5 flex items-center gap-2 cursor-pointer bg-[#23252f] hover:bg-[#272a36] select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-gray-500 text-[10px]">{open ? "▾" : "▸"}</span>
        <span className="text-[12px] font-medium">{title}</span>
      </div>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

function StateBlock({ state, active }: { state: RawElement; active?: boolean }) {
  const guid = guidOf(state) ?? "";
  const a = (k: string) => getAttr(state, k);
  return (
    <div className={`mb-3 border rounded p-2 ${active ? "border-accent bg-accent/10" : "border-edge"}`}>
      <div className="text-[11px] text-accent mb-1.5">
        {a("name") ?? state.tag}
        {active && <span className="ml-1 text-gray-500">· previewing</span>}
      </div>
      {["width", "height", "text", "textvalign", "texthalign", "font_m_font_name", "font_m_size", "font_m_colour", "colour", "shader_name"].map(
        (k) => (
          <SchemaField key={k} guid={guid} attrKey={k} value={a(k)} kind="state" />
        )
      )}
      <AddAttr guid={guid} kind="state" present={state.attrs.map((x) => x[0])} />
    </div>
  );
}

function ImageBlock({ img, dataRoot }: { img: RawElement; dataRoot: string | null }) {
  const guid = guidOf(img) ?? "";
  const path = getAttr(img, "imagepath");
  return (
    <div className="mb-2 border border-edge rounded p-2 flex gap-2 items-start">
      <div className="w-12 h-12 shrink-0 bg-[#0c0d12] border border-edge rounded flex items-center justify-center overflow-hidden">
        {path && dataRoot ? (
          <img
            src={imageUrl(path)}
            alt=""
            className="max-w-full max-h-full object-contain"
            style={{ imageRendering: "auto" }}
            onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
          />
        ) : (
          <span className="text-[9px] text-gray-600">no img</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <SchemaField guid={guid} attrKey="imagepath" value={path} kind="image" />
        <SchemaField guid={guid} attrKey="width" value={getAttr(img, "width")} kind="image" label="w" />
        <SchemaField guid={guid} attrKey="height" value={getAttr(img, "height")} kind="image" label="h" />
      </div>
    </div>
  );
}

export default function InspectorPanel() {
  const doc = useStore((s) => s.doc);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const dataRoot = useStore((s) => s.dataRoot);
  const applyComponentRaw = useStore((s) => s.applyComponentRaw);
  const applyHierarchyRaw = useStore((s) => s.applyHierarchyRaw);
  const [mode, setMode] = useState<"clean" | "raw">("clean");

  const comp =
    doc && selectedGuid ? componentMap(doc).get(selectedGuid) : undefined;

  if (!doc) {
    return <Empty msg="No file open." />;
  }
  if (!comp) {
    return <Empty msg="Select a component in the tree or visualizer." />;
  }

  const guid = guidOf(comp) ?? "";
  const states = componentStates(comp);
  const images = componentImages(comp);
  const hierNode = locateHier(doc, guid)?.node;

  const tab = (m: "clean" | "raw", label: string) => (
    <button
      className={`px-2 py-0.5 rounded text-[11px] border ${
        mode === m ? "bg-accent/30 border-accent" : "bg-[#2a2d3a] border-edge hover:bg-[#343849]"
      }`}
      onClick={() => setMode(m)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="px-3 h-9 flex items-center gap-2 border-b border-edge shrink-0">
        <span className="font-semibold text-[12px] truncate">{comp.tag}</span>
        <div className="flex-1" />
        {tab("clean", "Clean")}
        {tab("raw", "Raw")}
      </div>

      {mode === "raw" ? (
        <div className="flex-1 overflow-auto">
          <div className="px-3 py-1 text-[10px] text-gray-600 truncate">{guid}</div>
          <RawEditor title="Component" el={comp} seedKey={guid} onApply={(p) => applyComponentRaw(guid, p)} />
          <RawEditor
            title="Hierarchy node"
            el={hierNode}
            seedKey={guid}
            onApply={(p) => applyHierarchyRaw(guid, p)}
          />
        </div>
      ) : (
      <div className="flex-1 overflow-auto">
        {componentScriptId(comp) && <ScriptSection scriptId={componentScriptId(comp)!} />}
        <InheritanceSection doc={doc} guid={guid} />
        <Section title="Component">
          <SchemaField guid={guid} attrKey="id" value={getAttr(comp, "id")} kind="component" />
          <SchemaField guid={guid} attrKey="offset" value={getAttr(comp, "offset")} kind="component" />
          <DockingField guid={guid} comp={comp} />
          <SchemaField
            guid={guid}
            attrKey="component_anchor_point"
            value={getAttr(comp, "component_anchor_point")}
            kind="component"
          />
          <SchemaField guid={guid} attrKey="priority" value={getAttr(comp, "priority")} kind="component" />
          <AddAttr guid={guid} kind="component" present={comp.attrs.map((x) => x[0])} />
        </Section>

        <EmbeddedLayoutSection comp={comp} />

        <BindingsSection doc={doc} comp={comp} guid={guid} />

        <StatesSection guid={guid} states={states} />

        <Section title={`Images (${images.length})`} defaultOpen={images.length <= 6}>
          {images.length === 0 && <div className="text-gray-600 text-[11px]">No images.</div>}
          {images.map((im) => (
            <ImageBlock key={guidOf(im)} img={im} dataRoot={dataRoot} />
          ))}
        </Section>
      </div>
      )}
    </>
  );
}

function RawEditor({
  title,
  el,
  seedKey,
  onApply,
}: {
  title: string;
  el: RawElement | undefined;
  seedKey: string;
  onApply: (parsed: RawElement) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const reseed = useCallback(() => {
    if (!el) {
      setText("");
      return;
    }
    serializeElement(el).then((t) => {
      setText(t);
      setDirty(false);
      setError(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);

  // Re-seed from the model only when the selection changes (not on every edit).
  useEffect(() => {
    reseed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const apply = async () => {
    try {
      const parsed = await parseElement(text);
      onApply(parsed);
      setError(null);
      setDirty(false);
      const normalized = await serializeElement(parsed);
      setText(normalized);
    } catch (e) {
      setError(String(e));
    }
  };

  if (!el) return null;
  const rows = Math.min(40, Math.max(4, text.split("\n").length + 1));

  return (
    <div className="border-b border-edge">
      <div className="px-3 py-1.5 flex items-center gap-2 bg-[#23252f]">
        <span className="text-[12px] font-medium">{title}</span>
        <div className="flex-1" />
        <button
          className="px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px] disabled:opacity-40"
          onClick={reseed}
          disabled={!dirty}
        >
          Revert
        </button>
        <button
          className="px-2 py-0.5 rounded bg-accent/30 hover:bg-accent/40 border border-accent text-[11px] disabled:opacity-40"
          onClick={apply}
          disabled={!dirty}
        >
          Apply
        </button>
      </div>
      <textarea
        className="w-full font-mono text-[11px] leading-snug bg-[#0e0f15] border-0 px-3 py-2 outline-none resize-none whitespace-pre"
        style={{ tabSize: 4 }}
        value={text}
        spellCheck={false}
        rows={rows}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />
      {error && (
        <div className="text-red-400 text-[11px] px-3 py-1 whitespace-pre-wrap bg-red-950/30">{error}</div>
      )}
    </div>
  );
}

const INHERIT_LABEL: Record<Inheritance["kind"], string> = {
  script: "Script",
  list: "List item",
  context: "Context",
  state: "State",
};

/** Show what the selected component inherits from its ancestors. */
function InheritanceSection({ doc, guid }: { doc: TwuiDocument; guid: string }) {
  const select = useStore((s) => s.select);
  const items = inheritedContexts(doc, guid);
  if (items.length === 0) return null;
  return (
    <Section title="Inheritance">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 mb-1 text-[12px]">
          <span className="text-gray-400 w-16 shrink-0">{INHERIT_LABEL[it.kind]}</span>
          {it.label && <span className="text-gray-200 truncate">{it.label}</span>}
          <button
            className="ml-auto text-[11px] text-accent hover:underline shrink-0"
            onClick={() => select(it.fromGuid)}
            title={`Select ${it.fromId}`}
          >
            ↑ {it.fromId}
          </button>
        </div>
      ))}
    </Section>
  );
}

interface BindingRow {
  label: string;
  expr: string;
  value: string;
  index: number;
  objectId?: string;
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return "—";
  return String(v);
}

/** A component's Context* script-lookup callbacks, resolved against `scope`. */
function bindingRows(comp: RawElement, scope: Scope, loc?: Record<string, string>): BindingRow[] {
  const out: BindingRow[] = [];
  for (const cb of callbacks(comp)) {
    const fn = cb.funcId;
    // The current callback's context type drives shorthand-macro resolution;
    // `self.Id` is this component's own id (for non-list visibility comparisons).
    const cbScope: Scope = { ...scope, objectId: cb.objectId, selfId: getAttr(comp, "id") };
    const row = (label: string, value: string) =>
      out.push({ label, expr: fn ?? "", value, index: cb.index, objectId: cb.objectId });
    switch (cb.id) {
      case "ContextVisibilitySetter":
        if (fn) row("Visible if", fmtVal(evalCondition(fn, cbScope)));
        break;
      case "ContextTrashOnCondition":
        if (fn) row("Removed if", fmtVal(evalCondition(fn, cbScope)));
        break;
      case "ContextInactiveStateSetter":
        if (fn) row("Inactive if", fmtVal(evalCondition(fn, cbScope)));
        break;
      case "ContextImageSetter":
        if (fn) row("Image", evalImageSetter(fn, cbScope) ?? "—");
        break;
      case "ContextTextLabel":
        if (fn) row("Text", evalTextLabel(fn, cbScope, loc) ?? "—");
        break;
      case "ContextStateSetter":
        if (fn) row("State", fmtVal(evalExpr(fn, cbScope, loc)));
        break;
      case "List":
      case "ContextList": {
        const key = listSource(comp);
        const dp = scope.dataPack;
        const n =
          key && dp && typeof dp === "object" && !Array.isArray(dp)
            ? toEntries((dp as Record<string, unknown>)[key] as never).length
            : 0;
        row("List", key ? `${key} (${n} items)` : "—");
        break;
      }
    }
  }
  return out;
}

/** Editable binding expression — commits to the callback on blur / Enter. */
function ExprField({ guid, index, expr }: { guid: string; index: number; expr: string }) {
  const setCallbackFunc = useStore((s) => s.setCallbackFunc);
  const [local, setLocal] = useState(expr);
  useEffect(() => setLocal(expr), [expr, guid, index]);
  const commit = () => {
    if (local !== expr) setCallbackFunc(guid, index, local);
  };
  return (
    <textarea
      className="w-full text-[10px] font-mono leading-snug bg-[#0e0f15] border border-edge rounded px-1.5 py-1 outline-none resize-none"
      rows={Math.min(6, Math.max(1, Math.ceil(local.length / 48)))}
      spellCheck={false}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

/** A `ComponentCreator` component embeds a separate layout file as its content.
 *  Surface that path and let the user open it as the root layout to view it full-size. */
function EmbeddedLayoutSection({ comp }: { comp: RawElement }) {
  const layout = componentCreatorLayout(comp);
  const dataRoot = useStore((s) => s.dataRoot);
  const openFile = useStore((s) => s.openFile);
  if (!layout) return null;
  return (
    <Section title="Embedded layout">
      <div className="text-[11px] text-gray-300 break-all mb-1.5 font-mono">{layout}</div>
      <button
        className="text-[11px] px-2 py-1 rounded bg-[#2a2d3a] border border-edge hover:bg-[#333845] disabled:opacity-40"
        onClick={() => dataRoot && openFile(`${dataRoot}/${layout}.twui.xml`)}
        disabled={!dataRoot}
        title="Open this ComponentCreator template as the root layout"
      >
        Open as layout →
      </button>
    </Section>
  );
}

/** Show the component's script-context lookups (callbacks) + resolved values. */
function BindingsSection({ doc, comp, guid }: { doc: TwuiDocument; comp: RawElement; guid: string }) {
  const scriptText = useStore((s) => s.scriptConn.text);
  const scriptId = useStore((s) => s.scriptConn.id);
  const dataPackOverride = useStore((s) => s.dataPackOverride);
  const loc = useStore((s) => s.loc);
  const dataPack = useMemo(
    () =>
      (dataPackOverride as LuaValue | null) ??
      (scriptText && scriptId ? extractDataPack(scriptText, scriptId) : null),
    [dataPackOverride, scriptText, scriptId]
  );
  const ccoDocs = useStore((s) => s.ccoDocs);
  const ccoShorthand = useStore((s) => s.ccoShorthand);
  const scope = useMemo(
    () => ({ ...representativeScope(doc, guid, dataPack), shorthand: ccoShorthand ?? undefined }),
    [doc, guid, dataPack, ccoShorthand]
  );
  const rows = useMemo(() => bindingRows(comp, scope, loc), [comp, scope, loc]);
  if (rows.length === 0) return null;
  const fromList = scope.entry !== undefined;
  return (
    <Section title="Script bindings">
      {fromList && (
        <div className="text-[10px] text-gray-500 mb-1.5">Values shown for the first list item.</div>
      )}
      {rows.map((r, i) => {
        const hint = bindingHint(r.expr, r.objectId, ccoDocs);
        const macro = shorthandHint(r.expr, r.objectId, ccoShorthand);
        return (
          <div key={i} className="mb-2">
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="text-gray-400 text-[11px] w-16 shrink-0">{r.label}</span>
              <span className="text-[12px] text-accent break-all">{r.value}</span>
            </div>
            <ExprField guid={guid} index={r.index} expr={r.expr} />
            {hint && (
              <div className="text-[10px] text-gray-500 mt-0.5 break-words">
                <span className="text-gray-400">{hint.name}</span>
                <span className="text-gray-600"> → {hint.def.ret}</span>
                {hint.def.desc && <> · {hint.def.desc}</>}
              </div>
            )}
            {macro && (
              <div className="text-[10px] text-gray-500 mt-0.5 break-words">
                <span className="text-gray-400">{macro.name}</span>
                <span className="text-gray-600"> = {macro.expansion}</span>
                <span className="text-gray-600"> · macro ({macro.ccoType})</span>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

/** States list with a preview-state selector (renders the chosen state). */
function StatesSection({ guid, states }: { guid: string; states: RawElement[] }) {
  const preview = useStore((s) => s.previewState[guid]);
  const setPreviewState = useStore((s) => s.setPreviewState);
  const names = states.map((s) => getAttr(s, "name") ?? "");
  return (
    <Section title={`States (${states.length})`} defaultOpen={states.length <= 3}>
      {states.length === 0 ? (
        <div className="text-gray-600 text-[11px]">No states.</div>
      ) : (
        <>
          <label className="flex items-center gap-2 mb-2">
            <span className="text-gray-400 text-[11px] w-28 shrink-0">preview state</span>
            <select
              className="flex-1"
              value={preview ?? ""}
              onChange={(e) => setPreviewState(guid, e.target.value || null)}
            >
              <option value="">Default (active)</option>
              {names.map((n, i) => (
                <option key={i} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {states.map((s) => (
            <StateBlock key={guidOf(s)} state={s} active={(getAttr(s, "name") ?? "") === preview} />
          ))}
        </>
      )}
    </Section>
  );
}

/** Connect/inspect the Lua script that backs this panel (its script_id). */
function ScriptSection({ scriptId }: { scriptId: string }) {
  const conn = useStore((s) => s.scriptConn);
  const connectScript = useStore((s) => s.connectScript);
  const clearScript = useStore((s) => s.clearScript);
  const dataRoot = useStore((s) => s.dataRoot);

  // The connection in the store is the page script; only show its path/status
  // when it matches the selected component's script_id.
  const matches = conn.id === scriptId;
  const fileName = matches && conn.path ? conn.path.split(/[\\/]/).pop() : null;

  const pick = async () => {
    const file = await open({
      filters: [{ name: "Lua", extensions: ["lua"] }],
      defaultPath: dataRoot ? `${dataRoot}/script` : undefined,
    });
    if (typeof file === "string") connectScript(file);
  };

  const btn =
    "px-2 py-0.5 rounded bg-[#2a2d3a] hover:bg-[#343849] border border-edge text-[11px]";

  return (
    <Section title="Script">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">script_id</div>
      <div className="text-[12px] text-gray-200 break-all mb-2">{scriptId}</div>
      {matches && conn.status === "connected" ? (
        <div className="text-[11px] text-emerald-300/90 break-all mb-2" title={conn.path ?? ""}>
          ✓ {fileName}
        </div>
      ) : matches && conn.status === "missing" ? (
        <div className="text-[11px] text-amber-300/80 mb-2">
          No script found for this id — connect one manually.
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 mb-2">Not connected.</div>
      )}
      <div className="flex gap-1.5">
        <button className={btn} onClick={pick}>
          {matches && conn.status === "connected" ? "Change…" : "Connect…"}
        </button>
        {matches && conn.status === "connected" && (
          <button className={btn} onClick={clearScript}>
            Clear
          </button>
        )}
      </div>
    </Section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <>
      <div className="px-3 h-9 flex items-center border-b border-edge shrink-0">
        <span className="font-semibold text-[12px]">Inspector</span>
      </div>
      <div className="text-gray-500 text-[12px] p-3">{msg}</div>
    </>
  );
}
