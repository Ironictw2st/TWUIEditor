import { useCallback, useEffect, useState } from "react";
import { useStore } from "../state/store";
import {
  componentImages,
  componentMap,
  componentStates,
  getAttr,
  guidOf,
} from "../twui/doc";
import { locateHier } from "../twui/mutate";
import { RawElement } from "../types/twui";
import { imageUrl, parseElement, serializeElement } from "../ipc/commands";

const DOCKING_VALUES = [
  "None",
  "Top Left",
  "Top Center",
  "Top Right",
  "Center Left",
  "Center",
  "Center Right",
  "Bottom Left",
  "Bottom Center",
  "Bottom Right",
  "Top Left External",
  "Top Center External",
  "Top Right External",
  "Center Left External",
  "Center External",
  "Center Right External",
  "Bottom Left External",
  "Bottom Center External",
  "Bottom Right External",
];

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

function DockingField({ guid, value }: { guid: string; value: string | undefined }) {
  const editAttr = useStore((s) => s.editAttr);
  return (
    <label className="flex items-center gap-2 mb-1">
      <span className="text-gray-400 text-[11px] w-28 shrink-0">docking</span>
      <select
        className="flex-1"
        value={value ?? "None"}
        onChange={(e) => editAttr(guid, "docking", e.target.value)}
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

function StateBlock({ state }: { state: RawElement }) {
  const guid = guidOf(state) ?? "";
  const a = (k: string) => getAttr(state, k);
  return (
    <div className="mb-3 border border-edge rounded p-2">
      <div className="text-[11px] text-accent mb-1.5">{a("name") ?? state.tag}</div>
      <div className="flex gap-2">
        <Field guid={guid} attrKey="width" value={a("width")} label="width" />
        <Field guid={guid} attrKey="height" value={a("height")} label="height" />
      </div>
      <Field guid={guid} attrKey="text" value={a("text")} label="text" />
      <div className="flex gap-2">
        <Field guid={guid} attrKey="textvalign" value={a("textvalign")} label="v-align" />
        <Field guid={guid} attrKey="texthalign" value={a("texthalign")} label="h-align" />
      </div>
      <Field guid={guid} attrKey="font_m_font_name" value={a("font_m_font_name")} label="font" />
      <div className="flex gap-2">
        <Field guid={guid} attrKey="font_m_size" value={a("font_m_size")} label="font size" />
        <Field guid={guid} attrKey="font_m_colour" value={a("font_m_colour")} label="font colour" />
      </div>
      <Field guid={guid} attrKey="colour" value={a("colour")} label="tint colour" />
      <Field guid={guid} attrKey="shader_name" value={a("shader_name")} label="shader" />
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
        <Field guid={guid} attrKey="imagepath" value={path} />
        <div className="flex gap-2">
          <Field guid={guid} attrKey="width" value={getAttr(img, "width")} label="w" />
          <Field guid={guid} attrKey="height" value={getAttr(img, "height")} label="h" />
        </div>
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
        <Section title="Component">
          <Field guid={guid} attrKey="id" value={getAttr(comp, "id")} label="id" />
          <Field guid={guid} attrKey="offset" value={getAttr(comp, "offset")} label="offset (x,y)" />
          <DockingField guid={guid} value={getAttr(comp, "docking")} />
          <Field
            guid={guid}
            attrKey="component_anchor_point"
            value={getAttr(comp, "component_anchor_point")}
            label="anchor (0-1)"
          />
          <Field guid={guid} attrKey="priority" value={getAttr(comp, "priority")} label="priority" />
        </Section>

        <Section title={`States (${states.length})`} defaultOpen={states.length <= 3}>
          {states.length === 0 && <div className="text-gray-600 text-[11px]">No states.</div>}
          {states.map((s) => (
            <StateBlock key={guidOf(s)} state={s} />
          ))}
        </Section>

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
