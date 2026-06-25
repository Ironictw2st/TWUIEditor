import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";
import {
  ancestorGuids,
  childByTag,
  componentImages,
  componentMap,
  componentStates,
  elementChildren,
  getAttr,
  getLayoutEngine,
  guidOf,
  hierarchyRoot,
  layoutVersion,
  stateImages,
} from "../twui/doc";
import { describeMigration, previewMigration } from "../twui/migrate";
import { componentScriptId } from "../twui/script";
import { inheritedContexts, Inheritance, representativeScope } from "../twui/inherit";
import {
  callbacks,
  decodeEntities,
  evalCondition,
  evalExpr,
  evalImageSetter,
  evalTextLabel,
  imageSetterFunc,
  listSource,
  Scope,
  toEntries,
} from "../twui/cco";
import {
  componentImagePaths,
  EffectiveImage,
  effectiveImages,
  MIN_PARENT_IMAGE_VERSION,
} from "../twui/template";
import { extractDataPack, LuaValue } from "../twui/lua";
import { bindingHint } from "../twui/cco_docs";
import { shorthandHint } from "../twui/cco_shorthand";
import { componentCreatorLayout } from "../twui/creator";
import { attrInVersion, AttrKind, attrsFor, DOCKING_VALUES, schemaFor, validateAttr } from "../twui/schema";
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
      {label && <span className="text-textMuted text-[11px] w-28 shrink-0">{label}</span>}
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

const LABEL_CLS = "text-textMuted text-[11px] w-28 shrink-0";

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
  const editLayoutEngineAttr = useStore((s) => s.editLayoutEngineAttr);
  const version = useStore((s) => (s.doc ? layoutVersion(s.doc) : 0));
  // The LayoutEngine child has no guid; its edits route through the component's guid.
  const edit = kind === "layoutEngine" ? editLayoutEngineAttr : editAttr;
  const schema = schemaFor(attrKey, kind, version);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value, guid]);

  if (!schema) return <Field guid={guid} attrKey={attrKey} value={value} label={label ?? attrKey} />;

  const commit = () => {
    if (local !== (value ?? "")) edit(guid, attrKey, local);
  };
  const title = schema.description + (schema.default ? `  (default: ${schema.default})` : "");
  const labelEl = (
    <span className={LABEL_CLS} title={title}>
      {label ?? schema.label}
    </span>
  );
  const warn = validateAttr(schema, local);
  const warnEl = warn ? <div className="text-[10px] text-amber-400 mt-0.5 pl-[120px]">{warn}</div> : null;
  // Advisory note when a present attribute is out of range for this file's version (e.g. a
  // 3K-era attr left on a 142 file, or a 142 attr on a 135 file). Never blocks editing.
  const verHint = !attrInVersion(schema, version)
    ? schema.versions?.max !== undefined && version > schema.versions.max
      ? `removed after v${schema.versions.max}`
      : schema.versions?.min !== undefined && version < schema.versions.min
        ? `added in v${schema.versions.min}`
        : null
    : null;
  const verHintEl = verHint ? (
    <div className="text-[10px] text-amber-500/80 mt-0.5 pl-[120px]">not in v{version} ({verHint})</div>
  ) : null;

  if (schema.type === "enum" || schema.type === "bool") {
    const opts = schema.enumValues ?? [];
    const withCurrent = local && !opts.includes(local) ? [local, ...opts] : opts;
    return (
      <div className="mb-1">
        <label className="flex items-center gap-2">
          {labelEl}
          <select
            className="flex-1"
            value={local}
            onChange={(e) => {
              setLocal(e.target.value);
              edit(guid, attrKey, e.target.value);
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
        {verHintEl}
      </div>
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
      {verHintEl}
    </div>
  );
}

/** `Add…` dropdown: lists known schema attributes for `kind` that aren't already on the
 *  element; choosing one writes its default so the new field appears. */
function AddAttr({ guid, kind, present }: { guid: string; kind: AttrKind; present: string[] }) {
  const editAttr = useStore((s) => s.editAttr);
  const editLayoutEngineAttr = useStore((s) => s.editLayoutEngineAttr);
  const version = useStore((s) => (s.doc ? layoutVersion(s.doc) : 0));
  const edit = kind === "layoutEngine" ? editLayoutEngineAttr : editAttr;
  // Only offer attributes valid in this file's layout version (advisory: out-of-version
  // attrs already present stay editable, they're just not suggested for adding).
  const missing = attrsFor(kind, version).filter((s) => !present.includes(s.name));
  if (!missing.length) return null;
  return (
    <label className="flex items-center gap-2 mt-1.5">
      <span className="text-gray-500 text-[10px] w-28 shrink-0">add attribute</span>
      <select
        className="flex-1 text-[11px]"
        value=""
        onChange={(e) => {
          const name = e.target.value;
          if (name) edit(guid, name, schemaFor(name, kind)?.default ?? "");
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

/** The attribute keys to render for an element in clean view: every attribute actually
 *  present, ordered by `preferred` first, then any remaining present attrs in document
 *  order; `skip` drops attrs owned by a dedicated control (e.g. docking). Schema entries
 *  flagged `priorityHint: "low"` (editor cruft) sink to the bottom. This is what makes
 *  clean view show *everything that exists* — the AddAttr dropdown then offers the rest. */
function presentAttrs(el: RawElement, kind: AttrKind, preferred: string[], skip: string[] = []): string[] {
  const skipSet = new Set(skip);
  const present = el.attrs.map((a) => a[0]).filter((k) => !skipSet.has(k));
  const presentSet = new Set(present);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const p of preferred) if (presentSet.has(p) && !seen.has(p)) (seen.add(p), ordered.push(p));
  for (const p of present) if (!seen.has(p)) (seen.add(p), ordered.push(p));
  const isLow = (k: string) => schemaFor(k, kind)?.priorityHint === "low";
  return [...ordered.filter((k) => !isLow(k)), ...ordered.filter(isLow)];
}

/** Attribute groups that normally carry the same value and should be edited as one.
 *  When every present member shares a value, the clean view collapses them into a single
 *  LinkedField (editing it writes all members); when they differ it falls back to showing
 *  each member separately so a real discrepancy is never hidden. Coincidental equality of
 *  attrs NOT listed here never merges. */
const LINKED_GROUPS: { keys: string[]; label: string }[] = [
  { keys: ["this", "uniqueguid"], label: "guid" },
  { keys: ["currentstate", "defaultstate"], label: "state guid" },
];

/** A single field standing in for a group of linked attributes (e.g. this + uniqueguid).
 *  Commits the value to every present member at once via `editAttrs` (one undo step). */
function LinkedField({
  guid,
  keys,
  value,
  label,
}: {
  guid: string;
  keys: string[];
  value: string | undefined;
  label: string;
}) {
  const editAttrs = useStore((s) => s.editAttrs);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value, guid]);

  const commit = () => {
    if (local !== (value ?? "")) editAttrs(guid, Object.fromEntries(keys.map((k) => [k, local])));
  };
  const title = `Edits ${keys.join(" + ")} together.`;

  return (
    <label className="flex items-center gap-2 mb-1">
      <span className={LABEL_CLS} title={title}>
        {label}
      </span>
      <input
        className="flex-1"
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

/** Render a field for every present attribute of `el` (see presentAttrs), collapsing the
 *  LINKED_GROUPS pairs into one synced field when their values match. */
function AttrFields({
  guid,
  el,
  kind,
  preferred,
  skip,
}: {
  guid: string;
  el: RawElement;
  kind: AttrKind;
  preferred: string[];
  skip?: string[];
}) {
  const order = presentAttrs(el, kind, preferred, skip);
  const orderSet = new Set(order);
  const consumed = new Set<string>();
  const out: React.ReactNode[] = [];
  for (const key of order) {
    if (consumed.has(key)) continue;
    const group = LINKED_GROUPS.find((g) => g.keys.includes(key));
    if (group) {
      const members = group.keys.filter((k) => orderSet.has(k));
      members.forEach((k) => consumed.add(k));
      const vals = members.map((k) => getAttr(el, k));
      if (members.length >= 2 && vals.every((v) => v === vals[0])) {
        out.push(<LinkedField key={`link:${group.label}`} guid={guid} keys={members} value={vals[0]} label={group.label} />);
      } else {
        for (const k of members) {
          out.push(<SchemaField key={k} guid={guid} attrKey={k} value={getAttr(el, k)} kind={kind} />);
        }
      }
      continue;
    }
    out.push(<SchemaField key={key} guid={guid} attrKey={key} value={getAttr(el, key)} kind={kind} />);
  }
  return <>{out}</>;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-edge">
      <div
        className="px-3 py-1.5 flex items-center gap-2 cursor-pointer bg-panelHeader hover:bg-panelAlt select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-gray-500 text-[10px]">{open ? "▾" : "▸"}</span>
        <span className="text-[12px] font-medium">{title}</span>
      </div>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

/** Read-only labelled rows for the attributes of a WH3 (v142) model element. These elements
 *  (`component_model_view`, `ComponentModel`) carry no guid, so they cannot be edited through
 *  the guid-based store path — we surface schema labels here and route edits to the Raw tab. */
function ModelRows({ el }: { el: RawElement }) {
  const version = useStore((s) => (s.doc ? layoutVersion(s.doc) : 0));
  return (
    <>
      {el.attrs.map(([k, v]) => {
        const schema = schemaFor(k, "model", version);
        return (
          <div key={k} className="flex items-center gap-2 mb-1">
            <span className={LABEL_CLS} title={schema?.description}>
              {schema?.label ?? k}
            </span>
            <span className="flex-1 text-[11px] text-textMuted break-all">{v}</span>
          </div>
        );
      })}
    </>
  );
}

/** The WH3 (v142) `<component_model_view>` (3D model porthole) for a component, if present. */
function ModelViewSection({ comp }: { comp: RawElement }) {
  const mv = childByTag(comp, "component_model_view");
  if (!mv) return null;
  const list = childByTag(mv, "model_list");
  const models = list ? elementChildren(list).filter((e) => e.tag === "ComponentModel") : [];
  return (
    <Section title={`Model View (3D)${models.length ? ` · ${models.length}` : ""}`} defaultOpen={false}>
      <div className="text-[10px] text-gray-600 mb-1.5">Read-only here (no guid) — edit via the Raw tab.</div>
      <ModelRows el={mv} />
      {models.map((m, i) => (
        <div key={i} className="mt-2 pt-1.5 border-t border-edge/50">
          <div className="text-[11px] font-medium mb-1">{getAttr(m, "id") ?? `model ${i + 1}`}</div>
          <ModelRows el={m} />
        </div>
      ))}
    </Section>
  );
}

/** Supported conversion targets (129 is read-only legacy, not offered). */
const MIGRATE_TARGETS = [135, 136, 142];

/** Experimental layout-version converter. Rendered only on the root component (see the main
 *  panel) and only when `Settings > Experimental > Layout version conversion` is enabled.
 *  Converting renames/removes attributes per migrate.ts and is a single undoable step. */
function VersionSection() {
  const doc = useStore((s) => s.doc);
  const migrateVersion = useStore((s) => s.migrateVersion);
  const enabled = useStore((s) => s.settings.experimental.versionConversion);
  if (!doc) return null;
  const cur = layoutVersion(doc);
  const onConvert = (target: number) => {
    if (target === cur) return;
    const preview = previewMigration(doc, target);
    if (window.confirm(`${describeMigration(preview)}\n\nProceed? (undoable)`)) migrateVersion(target);
  };
  return (
    <Section title="Layout Version" defaultOpen={enabled}>
      <div className="flex items-center gap-2 mb-1">
        <span className={LABEL_CLS}>version</span>
        <span className="flex-1 text-[12px] tabular-nums">v{cur}</span>
      </div>
      {enabled ? (
        <>
          <div className="text-[10px] text-amber-500/80 mb-1.5">
            Experimental — converting rewrites version-specific attributes (undoable).
          </div>
          <label className="flex items-center gap-2">
            <span className={LABEL_CLS}>convert to</span>
            <select className="flex-1" value={cur} onChange={(e) => onConvert(parseInt(e.target.value, 10))}>
              {!MIGRATE_TARGETS.includes(cur) && <option value={cur}>v{cur}</option>}
              {MIGRATE_TARGETS.map((v) => (
                <option key={v} value={v}>
                  v{v}
                  {v === cur ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="text-[10px] text-gray-600">
          Version conversion is experimental — enable it in Settings &gt; Experimental.
        </div>
      )}
    </Section>
  );
}

/** Reorder (↑/↓) + delete (×) controls for one row of a structural list. Ends are disabled. */
function RowControls({
  index,
  count,
  onMove,
  onDelete,
}: {
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const b = "px-1 leading-none text-[11px] text-gray-400 hover:text-text disabled:opacity-25 disabled:hover:text-gray-400";
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button className={b} title="Move up" disabled={index <= 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button className={b} title="Move down" disabled={index >= count - 1} onClick={() => onMove(1)}>
        ↓
      </button>
      <button className={`${b} hover:text-red-400`} title="Delete" onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

/** A small `+ Add …` button used in structural-section headers. */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export interface CiOption {
  guid: string;
  imagepath: string;
}

/** Dropdown to pick which <component_image> an image-metric draws (its `componentimage` guid).
 *  Replaces the raw GUID text field. Keeps an unknown current value (e.g. a template image guid)
 *  selectable, mirroring SchemaField's enum handling. */
function ComponentImagePicker({
  imgGuid,
  value,
  options,
}: {
  imgGuid: string;
  value: string | undefined;
  options: CiOption[];
}) {
  const editAttr = useStore((s) => s.editAttr);
  const cur = value ?? "";
  const known = options.some((o) => o.guid === cur);
  const label = (o: CiOption) => o.imagepath || `(no path) ${o.guid.slice(0, 8)}`;
  return (
    <label className="flex items-center gap-2 mb-1">
      <span className={LABEL_CLS} title="The component image this layer draws (componentimage).">
        image
      </span>
      <select className="flex-1" value={cur} onChange={(e) => editAttr(imgGuid, "componentimage", e.target.value)}>
        {!cur && <option value="" />}
        {!known && cur && <option value={cur}>{`(external) ${cur.slice(0, 8)}`}</option>}
        {options.map((o) => (
          <option key={o.guid} value={o.guid}>
            {label(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Normalize a path to forward slashes, trimming a trailing slash. */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Make an absolute file path relative to the data root (forward-slashed). Returns null when the
 *  file is not under the data root. Case-insensitive (Windows). */
function dataRootRelative(abs: string, dataRoot: string): string | null {
  const a = normPath(abs);
  const root = normPath(dataRoot);
  if (a.toLowerCase().startsWith(root.toLowerCase() + "/")) return a.slice(root.length + 1);
  return null;
}

/** `imagepath` text field with a Browse… button that writes a data-root-relative path. */
function ImagePathField({
  guid,
  value,
  dataRoot,
}: {
  guid: string;
  value: string | undefined;
  dataRoot: string | null;
}) {
  const editAttr = useStore((s) => s.editAttr);
  const setStatus = useStore((s) => s.setStatus);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value, guid]);
  const commit = () => {
    if (local !== (value ?? "")) editAttr(guid, "imagepath", local);
  };
  const browse = async () => {
    const f = await open({
      filters: [{ name: "Images", extensions: ["png", "dds", "tga", "jpg", "jpeg"] }],
      defaultPath: dataRoot ? `${dataRoot}/ui` : undefined,
    });
    if (typeof f !== "string") return;
    const rel = dataRoot ? dataRootRelative(f, dataRoot) : null;
    if (rel) {
      setLocal(rel);
      editAttr(guid, "imagepath", rel);
    } else {
      const norm = normPath(f);
      setLocal(norm);
      editAttr(guid, "imagepath", norm);
      setStatus("Picked image is outside the data root — path may not resolve in-game.");
    }
  };
  return (
    <label className="flex items-center gap-2 mb-1">
      <span className={LABEL_CLS} title={schemaFor("imagepath", "component_image")?.description}>
        image path
      </span>
      <input
        className="flex-1 min-w-0"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <button
        className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px] shrink-0"
        onClick={browse}
      >
        Browse…
      </button>
    </label>
  );
}

/** One imagemetric <image> of a state: thumbnail of its linked componentimage + the
 *  per-state placement attrs (dockpoint/offset/size/colour), editable by the image's guid.
 *  Reorder = draw order within the state; delete via index (addressing is index-based since
 *  some image-metrics carry no guid). */
function ImageMetricBlock({
  img,
  ci,
  dataRoot,
  stateGuid,
  index,
  count,
  ciOptions,
}: {
  img: RawElement;
  ci: { imagepath: string } | undefined;
  dataRoot: string | null;
  stateGuid: string;
  index: number;
  count: number;
  ciOptions: CiOption[];
}) {
  const guid = guidOf(img) ?? "";
  const moveChild = useStore((s) => s.moveChild);
  const removeChild = useStore((s) => s.removeChild);
  const path = ci?.imagepath;
  const ciGuid = getAttr(img, "componentimage");
  return (
    <div className="mb-2 border border-edge rounded p-2 flex gap-2 items-start">
      <div className="w-12 h-12 shrink-0 bg-sunken border border-edge rounded flex items-center justify-center overflow-hidden">
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
        <div className="flex items-start gap-2">
          <div className="text-[11px] text-text break-all font-mono mb-0.5 flex-1 min-w-0">{path ?? `componentimage ${ciGuid ?? "—"}`}</div>
          <RowControls
            index={index}
            count={count}
            onMove={(dir) => moveChild(stateGuid, "imagemetrics", index, dir)}
            onDelete={() => removeChild(stateGuid, "imagemetrics", index)}
          />
        </div>
        <ComponentImagePicker imgGuid={guid} value={getAttr(img, "componentimage")} options={ciOptions} />
        <AttrFields
          guid={guid}
          el={img}
          kind="image"
          preferred={["dockpoint", "offset", "width", "height", "colour", "margin", "shader_name"]}
          skip={["componentimage"]}
        />
        <AddAttr guid={guid} kind="image" present={img.attrs.map((x) => x[0])} />
      </div>
    </div>
  );
}

function StateBlock({
  state,
  active,
  ciByGuid,
  dataRoot,
  compGuid,
  index,
  count,
  firstCiGuid,
  ciOptions,
}: {
  state: RawElement;
  active?: boolean;
  ciByGuid: Map<string, { imagepath: string }>;
  dataRoot: string | null;
  compGuid: string;
  index: number;
  count: number;
  firstCiGuid: string | undefined;
  ciOptions: CiOption[];
}) {
  const guid = guidOf(state) ?? "";
  const a = (k: string) => getAttr(state, k);
  const metrics = stateImages(state);
  const moveChild = useStore((s) => s.moveChild);
  const deleteState = useStore((s) => s.deleteState);
  const addImageMetric = useStore((s) => s.addImageMetric);
  return (
    <div className={`mb-3 border rounded p-2 ${active ? "border-accent bg-accent/10" : "border-edge"}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[11px] text-accent flex-1 min-w-0 truncate">
          {a("name") ?? state.tag}
          {active && <span className="ml-1 text-gray-500">· previewing</span>}
        </div>
        <RowControls
          index={index}
          count={count}
          onMove={(dir) => moveChild(compGuid, "states", index, dir)}
          onDelete={() => deleteState(compGuid, index)}
        />
      </div>
      <AttrFields
        guid={guid}
        el={state}
        kind="state"
        preferred={[
          "name",
          "this",
          "uniqueguid",
          "width",
          "height",
          "text",
          "textlabel",
          "textvalign",
          "texthalign",
          "texthbehaviour",
          "font_m_font_name",
          "font_m_size",
          "font_m_colour",
          "fontcat_name",
          "colour",
          "shader_name",
        ]}
      />
      <AddAttr guid={guid} kind="state" present={state.attrs.map((x) => x[0])} />
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 flex-1">Images ({metrics.length})</div>
          <AddButton label="+ Add image" onClick={() => addImageMetric(guid, firstCiGuid)} />
        </div>
        {metrics.map((img, i) => (
          <ImageMetricBlock
            key={guidOf(img) ?? `m${i}`}
            img={img}
            ci={ciByGuid.get(getAttr(img, "componentimage") ?? "")}
            dataRoot={dataRoot}
            stateGuid={guid}
            index={i}
            count={metrics.length}
            ciOptions={ciOptions}
          />
        ))}
      </div>
    </div>
  );
}

/** The component's `<LayoutEngine>` child (arranges its children as a list/grid/radial). Same
 *  schema-driven add-attribute system as the Component/State sections; edits route through the
 *  component guid since the LayoutEngine element has none of its own. */
function LayoutEngineSection({ guid, comp }: { guid: string; comp: RawElement }) {
  const le = getLayoutEngine(comp);
  const addLayoutEngine = useStore((s) => s.addLayoutEngine);
  return (
    <Section title="Layout Engine" defaultOpen={!!le}>
      {!le ? (
        <button
          className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
          onClick={() => addLayoutEngine(guid)}
        >
          + Add Layout Engine
        </button>
      ) : (
        <>
          <AttrFields
            guid={guid}
            el={le}
            kind="layoutEngine"
            preferred={[
              "type",
              "spacing",
              "sizetocontent",
              "horizontal_alignment",
              "vertical_alignment",
              "margins",
              "reverse_order",
              "itemsperrow",
            ]}
          />
          <AddAttr guid={guid} kind="layoutEngine" present={le.attrs.map((x) => x[0])} />
        </>
      )}
    </Section>
  );
}

/** A resolved/effective image (override_images + template, parent-determined slot 0).
 *  Read-only: templated/override images are computed, not backed by an editable element
 *  (edit them via the Raw tab to keep the file byte-identical). */
function EffectiveImageBlock({ img, dataRoot }: { img: EffectiveImage; dataRoot: string | null }) {
  const { imagepath: path, width, height } = img;
  return (
    <div className="mb-2 border border-edge rounded p-2 flex gap-2 items-start">
      <div className="w-12 h-12 shrink-0 bg-sunken border border-edge rounded flex items-center justify-center overflow-hidden">
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
        <div className="text-[11px] text-text break-all font-mono">{path || "—"}</div>
        {(width !== undefined || height !== undefined) && (
          <div className="text-[10px] text-textMuted mt-0.5">
            {width ?? "?"} × {height ?? "?"}
          </div>
        )}
      </div>
    </div>
  );
}

/** The component's own <component_image> definitions — where imagepath/size actually live —
 *  editable. Distinct from the resolved "Images" preview below, which can include
 *  template-resolved images that must stay read-only to keep the file byte-identical. */
function ComponentImagesSection({ guid, comp, dataRoot }: { guid: string; comp: RawElement; dataRoot: string | null }) {
  const cis = componentImages(comp);
  const addComponentImage = useStore((s) => s.addComponentImage);
  const deleteComponentImage = useStore((s) => s.deleteComponentImage);
  const moveChild = useStore((s) => s.moveChild);
  return (
    <Section title={`Component images (${cis.length})`} defaultOpen={cis.length <= 4}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1" />
        <AddButton label="+ Add image" onClick={() => addComponentImage(guid)} />
      </div>
      {cis.length === 0 && <div className="text-gray-600 text-[11px]">No component images.</div>}
      {cis.map((ci, i) => {
        const ciGuid = guidOf(ci) ?? "";
        const path = getAttr(ci, "imagepath");
        return (
          <div key={ciGuid || `ci${i}`} className="mb-2 border border-edge rounded p-2 flex gap-2 items-start">
            <div className="w-12 h-12 shrink-0 bg-sunken border border-edge rounded flex items-center justify-center overflow-hidden">
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
              <div className="flex justify-end">
                <RowControls
                  index={i}
                  count={cis.length}
                  onMove={(dir) => moveChild(guid, "componentimages", i, dir)}
                  onDelete={() => deleteComponentImage(guid, i)}
                />
              </div>
              <ImagePathField guid={ciGuid} value={getAttr(ci, "imagepath")} dataRoot={dataRoot} />
              <AttrFields
                guid={ciGuid}
                el={ci}
                kind="component_image"
                preferred={["width", "height", "this", "uniqueguid", "canuse1bitalpha"]}
                skip={["imagepath"]}
              />
              <AddAttr guid={ciGuid} kind="component_image" present={ci.attrs.map((x) => x[0])} />
            </div>
          </div>
        );
      })}
    </Section>
  );
}

export default function InspectorPanel() {
  const doc = useStore((s) => s.doc);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const dataRoot = useStore((s) => s.dataRoot);
  const applyComponentRaw = useStore((s) => s.applyComponentRaw);
  const applyHierarchyRaw = useStore((s) => s.applyHierarchyRaw);
  const openSearch = useStore((s) => s.openSearch);
  const templates = useStore((s) => s.templates);
  const scriptText = useStore((s) => s.scriptConn.text);
  const scriptId = useStore((s) => s.scriptConn.id);
  const dataPackOverride = useStore((s) => s.dataPackOverride);
  const ccoShorthand = useStore((s) => s.ccoShorthand);
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
  const hierNode = locateHier(doc, guid)?.node;
  // The root of the TWUI hierarchy — the only component where layout-version conversion is offered.
  const rootEl = hierarchyRoot(doc);
  const isRoot = !!guid && !!rootEl && guidOf(rootEl) === guid;

  // Effective images for display: override_images (resolved against the template) for
  // templated components, and a parent-determined slot 0 when a ContextImageSetter
  // resolves (incl. `self.ParentContext.ImagePath(N)`) — so the stale placeholder is gone.
  const ver = layoutVersion(doc);
  const gateImages = ver >= MIN_PARENT_IMAGE_VERSION;
  const dataPack =
    (dataPackOverride as LuaValue | null) ??
    (scriptText && scriptId ? extractDataPack(scriptText, scriptId) : null);
  const ancestors = ancestorGuids(doc, guid);
  const parentComp =
    ancestors.length ? componentMap(doc).get(ancestors[ancestors.length - 1]) : undefined;
  const imageScope: Scope = {
    ...representativeScope(doc, guid, dataPack),
    shorthand: ccoShorthand ?? undefined,
    parentImages: gateImages && parentComp ? componentImagePaths(parentComp) : undefined,
  };
  const setterFn = imageSetterFunc(comp);
  const slot0 = gateImages && setterFn ? evalImageSetter(setterFn, imageScope) ?? undefined : undefined;
  const images = effectiveImages(comp, templates, undefined, slot0);

  const tab = (m: "clean" | "raw", label: string) => (
    <button
      className={`px-2 py-0.5 rounded text-[11px] border ${
        mode === m ? "bg-accent/30 border-accent" : "bg-button border-edge hover:bg-buttonHover"
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
        <button
          className="px-2 py-0.5 rounded text-[11px] border bg-button border-edge hover:bg-buttonHover"
          onClick={() => openSearch("refs")}
          title="Find components that reference this one"
        >
          Refs
        </button>
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
        {isRoot && <VersionSection />}
        {componentScriptId(comp) && <ScriptSection scriptId={componentScriptId(comp)!} />}
        <InheritanceSection doc={doc} guid={guid} />
        <Section title="Component">
          <SchemaField guid={guid} attrKey="id" value={getAttr(comp, "id")} kind="component" />
          <SchemaField guid={guid} attrKey="offset" value={getAttr(comp, "offset")} kind="component" />
          <DockingField guid={guid} comp={comp} />
          <AttrFields
            guid={guid}
            el={comp}
            kind="component"
            preferred={[
              "this",
              "uniqueguid",
              "component_anchor_point",
              "priority",
              "dimensions",
              "template_id",
              "part_of_template",
              "currentstate",
              "defaultstate",
            ]}
            skip={["id", "offset", "docking", "dock_point"]}
          />
          <AddAttr guid={guid} kind="component" present={comp.attrs.map((x) => x[0])} />
        </Section>

        <LayoutEngineSection guid={guid} comp={comp} />

        <EmbeddedLayoutSection comp={comp} />

        <BindingsSection doc={doc} comp={comp} guid={guid} />

        <CallbacksSection guid={guid} comp={comp} />

        <StatesSection guid={guid} comp={comp} states={states} />

        <ComponentImagesSection guid={guid} comp={comp} dataRoot={dataRoot} />

        <ModelViewSection comp={comp} />

        <Section title={`Images (${images.length})`} defaultOpen={images.length <= 6}>
          {images.length === 0 && <div className="text-gray-600 text-[11px]">No images.</div>}
          {images.map((im, i) => (
            <EffectiveImageBlock key={`${im.imagepath}:${i}`} img={im} dataRoot={dataRoot} />
          ))}
        </Section>

        <GuidsSection guid={guid} label={getAttr(comp, "id") ?? comp.tag} />
      </div>
      )}
    </>
  );
}

/** Regenerate GUIDs (format-preserving; references stay linked) at three scopes. Lives here so the
 *  user can pick this component, this component + its subtree, or the whole document. */
function GuidsSection({ guid, label }: { guid: string; label: string }) {
  const regenGuids = useStore((s) => s.regenGuids);
  const regenComponentGuids = useStore((s) => s.regenComponentGuids);
  const regenSubtreeGuids = useStore((s) => s.regenSubtreeGuids);
  const b = "w-full text-left px-2 py-1 mb-1 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]";
  return (
    <Section title="GUIDs" defaultOpen={false}>
      <div className="text-[10px] text-gray-500 mb-2">
        Replace GUIDs with fresh ones of the same format; internal references stay linked. Undoable.
      </div>
      <button className={b} onClick={() => regenComponentGuids(guid)}>
        Regen this component ({label})
      </button>
      <button className={b} onClick={() => regenSubtreeGuids(guid)}>
        Regen this component + subtree
      </button>
      <button
        className={b}
        onClick={() => {
          if (window.confirm("Replace EVERY GUID in this document with a fresh one? Internal references stay linked. This can be undone."))
            regenGuids();
        }}
      >
        Regen all GUIDs in document
      </button>
    </Section>
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
      <div className="px-3 py-1.5 flex items-center gap-2 bg-panelHeader">
        <span className="text-[12px] font-medium">{title}</span>
        <div className="flex-1" />
        <button
          className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px] disabled:opacity-40"
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
        className="w-full font-mono text-[11px] leading-snug bg-codebg border-0 px-3 py-2 outline-none resize-none whitespace-pre"
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
          <span className="text-textMuted w-16 shrink-0">{INHERIT_LABEL[it.kind]}</span>
          {it.label && <span className="text-text truncate">{it.label}</span>}
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
      className="w-full text-[10px] font-mono leading-snug bg-codebg border border-edge rounded px-1.5 py-1 outline-none resize-none"
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
  const packMode = useStore((s) => s.packMode);
  const openFile = useStore((s) => s.openFile);
  if (!layout) return null;
  // In pack mode resolve through the data source by relative path; in folder
  // mode open the absolute file so Save writes back in place.
  const open = () =>
    packMode
      ? openFile(`${layout}.twui.xml`, true)
      : dataRoot && openFile(`${dataRoot}/${layout}.twui.xml`);
  return (
    <Section title="Embedded layout">
      <div className="text-[11px] text-text break-all mb-1.5 font-mono">{layout}</div>
      <button
        className="text-[11px] px-2 py-1 rounded bg-button border border-edge hover:bg-buttonHover disabled:opacity-40"
        onClick={open}
        disabled={!dataRoot && !packMode}
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
              <span className="text-textMuted text-[11px] w-16 shrink-0">{r.label}</span>
              <span className="text-[12px] text-accent break-all">{r.value}</span>
            </div>
            <ExprField guid={guid} index={r.index} expr={r.expr} />
            {hint && (
              <div className="text-[10px] text-gray-500 mt-0.5 break-words">
                <span className="text-textMuted">{hint.name}</span>
                <span className="text-gray-600"> → {hint.def.ret}</span>
                {hint.def.desc && <> · {hint.def.desc}</>}
              </div>
            )}
            {macro && (
              <div className="text-[10px] text-gray-500 mt-0.5 break-words">
                <span className="text-textMuted">{macro.name}</span>
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

/** One editable attribute of a callback (callback_id / context_object_id / context_function_id),
 *  addressed by (container tag, element index). Function ids are entity-decoded for display and
 *  re-encoded on write by the store. */
function CallbackField({
  guid,
  tag,
  index,
  attr,
  label,
  value,
  decode,
}: {
  guid: string;
  tag: string;
  index: number;
  attr: string;
  label: string;
  value: string | undefined;
  decode?: boolean;
}) {
  const setCallbackAttr = useStore((s) => s.setCallbackAttr);
  const shown = decode && value !== undefined ? decodeEntities(value) : value ?? "";
  const [local, setLocal] = useState(shown);
  useEffect(() => setLocal(shown), [shown, guid, tag, index]);
  const commit = () => {
    if (local !== shown) setCallbackAttr(guid, tag, index, attr, local);
  };
  return (
    <label className="flex items-center gap-2 mb-1">
      <span className={LABEL_CLS}>{label}</span>
      <input
        className="flex-1"
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

/** Raw editable list of the component's <callback_with_context> entries (add/delete/reorder + the
 *  three callback attributes). Complements the resolved BindingsSection above. */
function CallbacksSection({ guid, comp }: { guid: string; comp: RawElement }) {
  const addCallback = useStore((s) => s.addCallback);
  const moveChild = useStore((s) => s.moveChild);
  const removeChild = useStore((s) => s.removeChild);
  // Rows carry their owning container tag + element-child index (what moveChild/removeChild use).
  const rows: { tag: string; index: number; el: RawElement; count: number }[] = [];
  for (const tag of ["callbackwithcontextlist", "callbacks_with_context"]) {
    const list = childByTag(comp, tag);
    if (!list) continue;
    const kids = elementChildren(list);
    kids.forEach((el, index) => {
      if (el.tag === "callback_with_context") rows.push({ tag, index, el, count: kids.length });
    });
  }
  return (
    <Section title={`Callbacks (${rows.length})`} defaultOpen={rows.length > 0 && rows.length <= 6}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1" />
        <AddButton label="+ Add callback" onClick={() => addCallback(guid)} />
      </div>
      {rows.length === 0 && <div className="text-gray-600 text-[11px]">No callbacks.</div>}
      {rows.map((r, k) => (
        <div key={k} className="mb-2 border border-edge rounded p-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[11px] text-accent flex-1 min-w-0 truncate">
              {getAttr(r.el, "callback_id") || "(callback)"}
            </div>
            <RowControls
              index={r.index}
              count={r.count}
              onMove={(dir) => moveChild(guid, r.tag, r.index, dir)}
              onDelete={() => removeChild(guid, r.tag, r.index)}
            />
          </div>
          <CallbackField guid={guid} tag={r.tag} index={r.index} attr="callback_id" label="callback" value={getAttr(r.el, "callback_id")} />
          <CallbackField guid={guid} tag={r.tag} index={r.index} attr="context_object_id" label="object" value={getAttr(r.el, "context_object_id")} />
          <CallbackField guid={guid} tag={r.tag} index={r.index} attr="context_function_id" label="function" value={getAttr(r.el, "context_function_id")} decode />
        </div>
      ))}
    </Section>
  );
}

/** States list with a preview-state selector (renders the chosen state). */
function StatesSection({ guid, comp, states }: { guid: string; comp: RawElement; states: RawElement[] }) {
  const preview = useStore((s) => s.previewState[guid]);
  const setPreviewState = useStore((s) => s.setPreviewState);
  const dataRoot = useStore((s) => s.dataRoot);
  const addState = useStore((s) => s.addState);
  const names = states.map((s) => getAttr(s, "name") ?? "");
  // componentimage guid -> imagepath, so each state's imagemetrics can show a thumbnail.
  const ciByGuid = new Map<string, { imagepath: string }>();
  for (const ci of componentImages(comp)) {
    const g = guidOf(ci);
    const p = getAttr(ci, "imagepath");
    if (g && p) ciByGuid.set(g, { imagepath: p });
  }
  const ciOptions: CiOption[] = componentImages(comp).map((ci) => ({
    guid: guidOf(ci) ?? "",
    imagepath: getAttr(ci, "imagepath") ?? "",
  }));
  const firstCiGuid = ciOptions[0]?.guid || undefined;
  return (
    <Section title={`States (${states.length})`} defaultOpen={states.length <= 3}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1" />
        <AddButton label="+ Add state" onClick={() => addState(guid)} />
      </div>
      {states.length === 0 ? (
        <div className="text-gray-600 text-[11px]">No states.</div>
      ) : (
        <>
          <label className="flex items-center gap-2 mb-2">
            <span className="text-textMuted text-[11px] w-28 shrink-0">preview state</span>
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
          {states.map((s, i) => (
            <StateBlock
              key={guidOf(s) ?? `s${i}`}
              state={s}
              active={(getAttr(s, "name") ?? "") === preview}
              ciByGuid={ciByGuid}
              dataRoot={dataRoot}
              compGuid={guid}
              index={i}
              count={states.length}
              firstCiGuid={firstCiGuid}
              ciOptions={ciOptions}
            />
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
    "px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]";

  return (
    <Section title="Script">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">script_id</div>
      <div className="text-[12px] text-text break-all mb-2">{scriptId}</div>
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
