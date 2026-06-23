import React, { useState } from "react";
import { useStore } from "../state/store";
import { ACTIONS, formatBinding } from "../keybinds";
import { componentMap, getAttr } from "../twui/doc";
import type { Mode } from "../state/store";
import type { TwuiDocument } from "../types/twui";

// Photoshop-style floating tool palette, docked to the left of the visualizer canvas. Edit tools
// (Select / Move / Create) and preview tools (Simulate / Tooltip) switch the active mode; the
// action buttons (Copy / Paste / Duplicate / Delete) fire one-shot store actions.

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const SelectIcon = () => (
  <Svg>
    <path d="M5 2.5l14 7-6.3 1.9-1.9 6.3z" fill="currentColor" stroke="none" />
  </Svg>
);
const MoveIcon = () => (
  <Svg>
    <path d="M12 3v18M3 12h18" />
    <path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5" />
    <path d="M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
  </Svg>
);
const CreateIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
const SimIcon = () => (
  <Svg>
    <path d="M7 5l11 7-11 7z" fill="currentColor" stroke="none" />
  </Svg>
);
const TooltipIcon = () => (
  <Svg>
    <path d="M4 5h16v10H8l-4 4z" />
  </Svg>
);
const CopyIcon = () => (
  <Svg>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
);
const PasteIcon = () => (
  <Svg>
    <rect x="6" y="5" width="12" height="15" rx="2" />
    <rect x="9" y="3" width="6" height="3.6" rx="1" />
  </Svg>
);
const DuplicateIcon = () => (
  <Svg>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M5 16V6a2 2 0 0 1 2-2h9" />
    <path d="M14 11v6M11 14h6" />
  </Svg>
);
const DeleteIcon = () => (
  <Svg>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </Svg>
);
const AlignToolIcon = () => (
  <Svg>
    <rect x="4" y="5" width="6" height="6" rx="1" />
    <rect x="14" y="5" width="6" height="6" rx="1" />
    <path d="M4 16h16" />
  </Svg>
);
const AlignXIcon = () => (
  <Svg>
    <path d="M5 3v18" />
    <rect x="8" y="6" width="11" height="4" rx="1" />
    <rect x="8" y="14" width="7" height="4" rx="1" />
  </Svg>
);
const AlignYIcon = () => (
  <Svg>
    <path d="M3 5h18" />
    <rect x="6" y="8" width="4" height="11" rx="1" />
    <rect x="14" y="8" width="4" height="7" rx="1" />
  </Svg>
);
const CenterIcon = () => (
  <Svg>
    <circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="20" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <rect x="9" y="8" width="6" height="8" rx="1" />
    <path d="M6 12h2M16 12h2" />
  </Svg>
);
const DistributeXIcon = () => (
  <Svg>
    <path d="M4 4v16M12 4v16M20 4v16" />
  </Svg>
);
const DistributeYIcon = () => (
  <Svg>
    <path d="M4 4h16M4 12h16M4 20h16" />
  </Svg>
);
const UndoIcon = () => (
  <Svg>
    <path d="M9 7L4 12l5 5" />
    <path d="M4 12h11a5 5 0 0 1 0 10h-1" />
  </Svg>
);
const RedoIcon = () => (
  <Svg>
    <path d="M15 7l5 5-5 5" />
    <path d="M20 12H9a5 5 0 0 0 0 10h1" />
  </Svg>
);

function ToolButton({
  active,
  disabled,
  label,
  shortcut,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative group">
      <button
        disabled={disabled}
        onClick={onClick}
        className={`w-9 h-9 flex items-center justify-center rounded-md transition-colors ${
          active
            ? "bg-accent/25 text-accent ring-1 ring-accent/50"
            : disabled
            ? "text-gray-600 cursor-default"
            : "text-gray-400 hover:bg-[#2a2d3a] hover:text-gray-100"
        }`}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 z-20 hidden group-hover:flex items-center gap-2 whitespace-nowrap rounded bg-[#0c0d12] border border-edge px-2 py-1 text-[11px] text-gray-200 shadow-lg">
        <span>{label}</span>
        {shortcut && <span className="text-gray-500">{shortcut}</span>}
      </div>
    </div>
  );
}

const Divider = () => <div className="h-px my-1 mx-1.5 bg-edge" />;

/** Display shortcut for a registered action id (platform-correct). */
function kb(id: string): string {
  const a = ACTIONS.find((x) => x.id === id);
  return a ? formatBinding(a.defaultBinding) : "";
}

/** Asks which selected component to act on (the align reference, or the centre piece). Lists the
 *  multi-selection by id; picking one fires `onPick`. */
function PickComponentPopover({
  title,
  guids,
  doc,
  onPick,
  onClose,
}: {
  title: string;
  guids: string[];
  doc: TwuiDocument;
  onPick: (guid: string) => void;
  onClose: () => void;
}) {
  const cmap = componentMap(doc);
  const labelOf = (g: string) => {
    const c = cmap.get(g);
    return (c && getAttr(c, "id")) || g.slice(0, 8);
  };
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute left-12 top-1/2 -translate-y-1/2 z-30 w-52 max-h-72 overflow-auto rounded-md bg-[#0c0d12] border border-edge shadow-xl p-1">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500">{title}</div>
        {guids.map((g) => (
          <button
            key={g}
            className="block w-full text-left px-2 py-1 rounded text-[11px] text-gray-200 hover:bg-[#23252f] truncate"
            onClick={() => onPick(g)}
          >
            {labelOf(g)}
          </button>
        ))}
      </div>
    </>
  );
}

export default function ToolPalette() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const selectedGuid = useStore((s) => s.selectedGuid);
  const selectedGuids = useStore((s) => s.selectedGuids);
  const alignSelected = useStore((s) => s.alignSelected);
  const centerBetween = useStore((s) => s.centerBetween);
  const distributeSelected = useStore((s) => s.distributeSelected);
  const hasClip = useStore((s) => s.clipboard !== null);
  const copy = useStore((s) => s.copy);
  const paste = useStore((s) => s.paste);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const [picker, setPicker] = useState<"alignX" | "alignY" | "center" | null>(null);
  if (!doc) return null;
  const canAlign = selectedGuids.length >= 2;
  const canCenter = selectedGuids.length === 3;
  const canDistribute = selectedGuids.length >= 3;
  const pickerTitle =
    picker === "center"
      ? "Center which? (midpoint of the other two)"
      : picker === "alignX"
      ? "Align X to…"
      : "Align Y to…";
  const onPickComponent = (g: string) => {
    if (picker === "alignX") alignSelected("x", g);
    else if (picker === "alignY") alignSelected("y", g);
    else if (picker === "center") centerBetween(g);
    setPicker(null);
  };

  const modeBtn = (m: Mode, label: string, shortId: string, icon: React.ReactNode) => (
    <ToolButton active={mode === m} label={label} shortcut={kb(shortId)} onClick={() => setMode(m)}>
      {icon}
    </ToolButton>
  );

  return (
    <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-0.5 p-1 rounded-lg bg-[#1a1b22]/95 border border-edge shadow-xl backdrop-blur-sm">
      {modeBtn("view", "Select", "tool-select", <SelectIcon />)}
      {modeBtn("move", "Move", "tool-move", <MoveIcon />)}
      {modeBtn("create", "Create", "tool-create", <CreateIcon />)}
      {modeBtn("align", "Align", "tool-align", <AlignToolIcon />)}
      {mode === "align" && (
        <>
          <ToolButton
            active={picker === "alignX"}
            disabled={!canAlign}
            label="Align X (pick reference)"
            onClick={() => setPicker((p) => (p === "alignX" ? null : "alignX"))}
          >
            <AlignXIcon />
          </ToolButton>
          <ToolButton
            active={picker === "alignY"}
            disabled={!canAlign}
            label="Align Y (pick reference)"
            onClick={() => setPicker((p) => (p === "alignY" ? null : "alignY"))}
          >
            <AlignYIcon />
          </ToolButton>
          <ToolButton
            active={picker === "center"}
            disabled={!canCenter}
            label="Center between two (pick the middle)"
            onClick={() => setPicker((p) => (p === "center" ? null : "center"))}
          >
            <CenterIcon />
          </ToolButton>
          <ToolButton
            disabled={!canDistribute}
            label="Distribute evenly across a row (X)"
            onClick={() => distributeSelected("x")}
          >
            <DistributeXIcon />
          </ToolButton>
          <ToolButton
            disabled={!canDistribute}
            label="Distribute evenly down a column (Y)"
            onClick={() => distributeSelected("y")}
          >
            <DistributeYIcon />
          </ToolButton>
        </>
      )}
      {picker && (picker === "center" ? canCenter : canAlign) && (
        <PickComponentPopover
          title={pickerTitle}
          guids={selectedGuids}
          doc={doc}
          onPick={onPickComponent}
          onClose={() => setPicker(null)}
        />
      )}
      <Divider />
      {modeBtn("sim", "Simulate", "", <SimIcon />)}
      {modeBtn("tooltip", "Tooltip", "", <TooltipIcon />)}
      <Divider />
      <ToolButton disabled={!canUndo} label="Undo" shortcut={kb("undo")} onClick={undo}>
        <UndoIcon />
      </ToolButton>
      <ToolButton disabled={!canRedo} label="Redo" shortcut={kb("redo")} onClick={redo}>
        <RedoIcon />
      </ToolButton>
      <Divider />
      <ToolButton disabled={!selectedGuid} label="Copy" shortcut={kb("copy")} onClick={copy}>
        <CopyIcon />
      </ToolButton>
      <ToolButton disabled={!hasClip} label="Paste" shortcut={kb("paste")} onClick={paste}>
        <PasteIcon />
      </ToolButton>
      <ToolButton disabled={!selectedGuid} label="Duplicate" shortcut={kb("duplicate")} onClick={duplicateSelected}>
        <DuplicateIcon />
      </ToolButton>
      <ToolButton disabled={!selectedGuid} label="Delete" shortcut={kb("delete")} onClick={deleteSelected}>
        <DeleteIcon />
      </ToolButton>
    </div>
  );
}
