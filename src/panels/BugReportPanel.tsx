import { useState } from "react";
import { pickOpenFiles } from "../ipc/dialog";
import { useStore } from "../state/store";
import { captureAppWindow, submitBugReport, InlineImage } from "../ipc/commands";
import { captureVisualizer } from "./visualizerCapture";

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Wait two animation frames so the webview repaints after the modal is hidden. */
function nextRepaint(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** A captured-image row: thumbnail with Retake / Remove, or an empty-state with a capture button. */
function ShotRow({
  label,
  shot,
  onRetake,
  onRemove,
  emptyNote,
  busy,
}: {
  label: string;
  shot: string | null;
  onRetake: () => void;
  onRemove: () => void;
  emptyNote: string;
  busy?: boolean;
}) {
  const smallBtn =
    "px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px] disabled:opacity-40";
  return (
    <div className="flex items-start gap-3">
      <div className="w-28 shrink-0 text-[11px] text-textMuted pt-1">{label}</div>
      {shot ? (
        <div className="flex items-start gap-2">
          <img
            src={shot}
            alt={label}
            className="h-24 max-w-[280px] rounded border border-edge object-contain bg-sunken"
          />
          <div className="flex flex-col gap-1">
            <button className={smallBtn} onClick={onRetake} disabled={busy}>
              Retake
            </button>
            <button className={smallBtn} onClick={onRemove} disabled={busy}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">{emptyNote}</span>
          <button className={smallBtn} onClick={onRetake} disabled={busy}>
            Capture
          </button>
        </div>
      )}
    </div>
  );
}

/** In-app bug reporter: a description plus an app-window shot, a native-resolution visualizer
 *  render, and any extra uploads — delivered to the author's Discord webhook. */
export default function BugReportPanel({
  onClose,
  initialProgramShot,
}: {
  onClose: () => void;
  initialProgramShot: string | null;
}) {
  const game = useStore((s) => s.game);
  const fileName = useStore((s) => s.fileName);
  const renderResolution = useStore((s) => s.renderResolution);
  const setStatus = useStore((s) => s.setStatus);

  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [programShot, setProgramShot] = useState<string | null>(initialProgramShot);
  const [vizShot, setVizShot] = useState<string | null>(() => captureVisualizer());
  const [uploads, setUploads] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retakeProgram = async () => {
    setError(null);
    setCapturing(true);
    // Hide the modal first so it isn't part of the shot, then let the webview repaint.
    await nextRepaint();
    try {
      setProgramShot(await captureAppWindow());
    } catch (e) {
      setError(`Couldn't capture the window: ${e}`);
    } finally {
      setCapturing(false);
    }
  };

  const retakeViz = () => {
    setError(null);
    setVizShot(captureVisualizer());
  };

  const addUploads = async () => {
    const paths = await pickOpenFiles({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (!paths) return;
    setUploads((u) => [...u, ...paths.filter((p) => !u.includes(p))]);
  };

  const submit = async () => {
    if (!description.trim() || sending) return;
    setSending(true);
    setError(null);
    const inlineImages: InlineImage[] = [];
    if (programShot) inlineImages.push({ name: "program.png", b64: programShot });
    if (vizShot) inlineImages.push({ name: "visualizer.png", b64: vizShot });
    const meta: Record<string, string> = {
      version: __APP_VERSION__,
      os: navigator.platform || navigator.userAgent,
      game: game ?? "",
      file: fileName ?? "",
      resolution: renderResolution ? `${renderResolution.w}x${renderResolution.h}` : "",
    };
    try {
      await submitBugReport({
        description,
        contact: contact.trim() || undefined,
        meta,
        inlineImages,
        filePaths: uploads,
      });
      setStatus("Bug report sent — thanks!");
      onClose();
    } catch (e) {
      setError(`${e}`);
      setSending(false);
    }
  };

  const canSubmit = description.trim().length > 0 && !sending;
  const hidden = capturing ? { visibility: "hidden" as const } : undefined;

  return (
    <div style={hidden}>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-12 -translate-x-1/2 w-[640px] max-h-[82vh] flex flex-col bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-2 border-b border-edge bg-panelHeader">
          <span className="font-semibold">Report a Bug</span>
          <div className="flex-1" />
          <button
            className="px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-textMuted">What went wrong?</label>
            <textarea
              autoFocus
              className="w-full h-28 resize-y rounded bg-sunken border border-edge px-2 py-1 text-[12px]"
              placeholder="Describe the bug: what you did, what you expected, and what happened instead."
              spellCheck
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-textMuted">Contact (optional)</label>
            <input
              className="w-full rounded bg-sunken border border-edge px-2 py-1 text-[12px]"
              placeholder="Discord handle or email, so I can follow up"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-edge pt-3">
            <ShotRow
              label="App window"
              shot={programShot}
              onRetake={retakeProgram}
              onRemove={() => setProgramShot(null)}
              emptyNote="No app screenshot."
              busy={capturing}
            />
            <ShotRow
              label="Visualizer"
              shot={vizShot}
              onRetake={retakeViz}
              onRemove={() => setVizShot(null)}
              emptyNote="Open a layout to capture the visualizer."
            />

            <div className="flex items-start gap-3">
              <div className="w-28 shrink-0 text-[11px] text-textMuted pt-1">More images</div>
              <div className="flex-1 flex flex-col gap-2">
                <button
                  className="self-start px-2 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge text-[11px]"
                  onClick={addUploads}
                >
                  Add images…
                </button>
                {uploads.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {uploads.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sunken border border-edge text-[10px]"
                        title={p}
                      >
                        <span className="max-w-[160px] truncate">{baseName(p)}</span>
                        <button
                          className="text-textMuted hover:text-text"
                          onClick={() => setUploads((u) => u.filter((x) => x !== p))}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 h-12 flex items-center gap-3 border-t border-edge bg-panelHeader">
          {error && <span className="text-[11px] text-red-400 truncate">{error}</span>}
          <div className="flex-1" />
          <button
            className="px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[12px]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-2.5 py-1 rounded bg-accent/30 border border-accent text-[12px] disabled:opacity-40"
            disabled={!canSubmit}
            onClick={submit}
          >
            {sending ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
