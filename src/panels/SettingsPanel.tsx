import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../state/store";
import { Mode } from "../state/store";
import {
  ACTIONS,
  bindingConflicts,
  bindingFor,
  canonBinding,
  formatBinding,
  normalizeEvent,
} from "../keybinds";
import { checkForUpdateVerbose, installAndRelaunch, type CheckResult } from "../updater";

type Category = "game" | "keybinds" | "perspective" | "visualizer" | "editor" | "theme" | "about";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "game", label: "Game & Data" },
  { id: "keybinds", label: "Keybinds" },
  { id: "perspective", label: "Perspective" },
  { id: "visualizer", label: "Visualizer" },
  { id: "editor", label: "Editor" },
  { id: "theme", label: "Theme" },
  { id: "about", label: "About / Updates" },
];

const btn =
  "px-2.5 py-1 rounded bg-button hover:bg-buttonHover border border-edge text-[12px] disabled:opacity-40";
const sel = "bg-bg border border-edge rounded text-[12px] px-1.5 py-1";

/** A labelled row: caption on the left, control on the right. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-2.5">
      <div className="w-44 shrink-0">
        <div className="text-[12px] text-text">{label}</div>
        {hint && <div className="text-[10px] text-gray-500">{hint}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-[12px] text-text">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{checked ? "On" : "Off"}</span>
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-semibold text-accent mb-3">{children}</div>;
}

/** Click to capture the next chord; Esc cancels. Intercepts in the capture phase so
 *  the app's global shortcut handler does not fire while rebinding. */
function KeyCaptureField({ binding, onCapture }: { binding: string; onCapture: (b: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      const b = normalizeEvent(e);
      if (!b) return; // a bare modifier press — keep waiting for the full chord
      onCapture(b);
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onCapture]);
  return (
    <button
      className={`px-2 py-0.5 rounded text-[11px] border min-w-[96px] ${
        capturing ? "bg-accent/30 border-accent" : "bg-button border-edge hover:bg-buttonHover"
      }`}
      onClick={() => setCapturing((c) => !c)}
      title={capturing ? "Press a key combination, or Esc to cancel" : "Click to rebind"}
    >
      {capturing ? "Press keys…" : formatBinding(binding)}
    </button>
  );
}

function GameSection() {
  const games = useStore((s) => s.games);
  const game = useStore((s) => s.game);
  const setGame = useStore((s) => s.setGame);
  const dataRoot = useStore((s) => s.dataRoot);
  const setDataRoot = useStore((s) => s.setDataRoot);

  const pick = async () => {
    const dir = await open({ directory: true, defaultPath: dataRoot ?? undefined });
    if (typeof dir === "string") setDataRoot(dir);
  };

  return (
    <div>
      <SectionTitle>Game & Data</SectionTitle>
      <Row label="Active game" hint="games/ subfolder">
        {games.length > 0 ? (
          <select className={sel} value={game ?? ""} onChange={(e) => setGame(e.target.value)}>
            {!game && <option value="">Game…</option>}
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-gray-500 text-[12px]">No games detected.</span>
        )}
      </Row>
      <Row label="Data folder" hint="where the game data lives">
        <div className="flex items-center gap-2">
          <button className={btn} onClick={pick}>
            Change…
          </button>
          <span className="text-[11px] text-textMuted truncate">{dataRoot ?? "not set"}</span>
        </div>
      </Row>
    </div>
  );
}

function KeybindsSection() {
  const keybinds = useStore((s) => s.settings.keybinds);
  const setKeybind = useStore((s) => s.setKeybind);
  const resetKeybinds = useStore((s) => s.resetKeybinds);
  const conflicts = bindingConflicts(keybinds);

  const categories = [...new Set(ACTIONS.map((a) => a.category))];
  return (
    <div>
      <div className="flex items-center mb-3">
        <SectionTitle>Keybinds</SectionTitle>
        <div className="flex-1" />
        <button className={btn} onClick={resetKeybinds}>
          Reset all
        </button>
      </div>
      {categories.map((cat) => (
        <div key={cat} className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">{cat}</div>
          {ACTIONS.filter((a) => a.category === cat).map((a) => {
            const binding = bindingFor(a, keybinds);
            const inConflict = !!conflicts[canonBinding(binding)];
            const overridden = a.id in keybinds;
            return (
              <div key={a.id} className="flex items-center gap-3 mb-1.5">
                <span className="w-44 shrink-0 text-[12px] text-text">{a.label}</span>
                {a.kind === "mouse" ? (
                  <select
                    className={sel}
                    value={canonBinding(binding)}
                    onChange={(e) => setKeybind(a.id, e.target.value)}
                  >
                    <option value="Shift">Shift+Click</option>
                    <option value="Alt">Alt+Click</option>
                    <option value="Mod">{formatBinding("Mod")}+Click</option>
                  </select>
                ) : (
                  <KeyCaptureField binding={binding} onCapture={(b) => setKeybind(a.id, b)} />
                )}
                {a.aliases?.length ? (
                  <span className="text-[10px] text-gray-500">or {a.aliases.map(formatBinding).join(", ")}</span>
                ) : null}
                {inConflict && <span className="text-[10px] text-amber-400">conflict</span>}
                {overridden && (
                  <button
                    className="text-[10px] text-accent hover:underline"
                    onClick={() => setKeybind(a.id, null)}
                  >
                    reset
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className="text-[10px] text-gray-500">
        Bindings persist across sessions. {formatBinding("Mod+Z")}-style chords use{" "}
        {formatBinding("Mod+")}as Ctrl (or Cmd on macOS).
      </div>
    </div>
  );
}

function PerspectiveSection() {
  const db = useStore((s) => s.contextDb);
  const context = useStore((s) => s.context);
  const setCampaign = useStore((s) => s.setCampaign);
  const setFaction = useStore((s) => s.setFaction);
  const setCulture = useStore((s) => s.setCulture);
  const setSubculture = useStore((s) => s.setSubculture);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const factions = db
    ? db.campaign_factions[context.campaign]
      ? db.factions.filter((f) => db.campaign_factions[context.campaign].includes(f.key))
      : db.factions
    : [];

  return (
    <div>
      <SectionTitle>Perspective defaults</SectionTitle>
      <p className="text-[11px] text-gray-500 mb-3">
        Drives which faction/culture the visualizer filters to. Set the live perspective here, then save it
        as the default applied on every launch.
      </p>
      <Row label="Campaign">
        <select className={sel} value={context.campaign} onChange={(e) => setCampaign(e.target.value)}>
          {db?.campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Faction">
        <select className={sel} value={context.faction} onChange={(e) => setFaction(e.target.value)}>
          {factions.map((f) => (
            <option key={f.key} value={f.key}>
              {f.screen_name || f.key}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Culture">
        <select className={sel} value={context.culture} onChange={(e) => setCulture(e.target.value)}>
          {db?.cultures.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Subculture">
        <select className={sel} value={context.subculture} onChange={(e) => setSubculture(e.target.value)}>
          {db?.subcultures.map((s) => (
            <option key={s.subculture} value={s.subculture}>
              {s.subculture}
            </option>
          ))}
        </select>
      </Row>
      <div className="flex items-center gap-2 mt-3">
        <button className={btn} onClick={() => updateSettings({ perspective: { ...context } })}>
          Save current as default
        </button>
        <button className={btn} onClick={() => updateSettings({ perspective: null })} disabled={!settings.perspective}>
          Clear default
        </button>
        <span className="text-[10px] text-gray-500">
          {settings.perspective ? "default saved" : "using built-in default"}
        </span>
      </div>
    </div>
  );
}

const MODES: Mode[] = ["view", "move", "sim", "tooltip"];

function VisualizerSection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const backgrounds = useStore((s) => s.backgrounds);
  const background = useStore((s) => s.background);
  const setBackground = useStore((s) => s.setBackground);
  const viz = settings.visualizer;
  const patchViz = (p: Partial<typeof viz>) => updateSettings({ visualizer: { ...viz, ...p } });

  return (
    <div>
      <SectionTitle>Visualizer defaults</SectionTitle>
      <Row label="Default mode" hint="on new sessions">
        <select className={sel} value={viz.defaultMode} onChange={(e) => patchViz({ defaultMode: e.target.value as Mode })}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Show bounds by default">
        <Toggle checked={viz.showBounds} onChange={(v) => patchViz({ showBounds: v })} />
      </Row>
      <Row label="Restore zoom/pan on open" hint="remember the camera">
        <Toggle checked={viz.restoreView} onChange={(v) => patchViz({ restoreView: v })} />
      </Row>
      <Row label="Background">
        <select className={sel} value={background ?? ""} onChange={(e) => setBackground(e.target.value || null)}>
          <option value="">None</option>
          <option value="@white">White</option>
          <option value="@black">Black</option>
          {backgrounds.map((b) => (
            <option key={b} value={b}>
              {b.replace(/^background\//, "")}
            </option>
          ))}
        </select>
      </Row>
    </div>
  );
}

function EditorSection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const ed = settings.editor;
  const patch = (p: Partial<typeof ed>) => updateSettings({ editor: { ...ed, ...p } });

  return (
    <div>
      <SectionTitle>Editor</SectionTitle>
      <Row label="Undo history limit" hint="snapshots kept">
        <input
          type="number"
          min={1}
          max={1000}
          className={`${sel} w-24`}
          value={ed.undoLimit}
          onChange={(e) => patch({ undoLimit: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
        />
      </Row>
      <Row label="Reopen last file on launch">
        <Toggle checked={ed.rememberLastFile} onChange={(v) => patch({ rememberLastFile: v })} />
      </Row>
    </div>
  );
}

function ThemeSection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const theme = settings.theme;
  const patch = (p: Partial<typeof theme>) => updateSettings({ theme: { ...theme, ...p } });
  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <Row label="Colour scheme">
        <select
          className={sel}
          value={theme.mode}
          onChange={(e) => patch({ mode: e.target.value as "system" | "light" | "dark" })}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Row>
      <Row label="Accent colour">
        <input type="color" value={theme.accent} onChange={(e) => patch({ accent: e.target.value })} />
      </Row>
      <Row label="Density">
        <select
          className={sel}
          value={theme.density}
          onChange={(e) => patch({ density: e.target.value as "comfortable" | "compact" })}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </Row>
    </div>
  );
}

function UpdatesSection() {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const check = async () => {
    setChecking(true);
    setResult(null);
    const r = await checkForUpdateVerbose();
    setResult(r);
    setChecking(false);
  };

  const install = async () => {
    if (result?.status !== "available") return;
    setBusy(true);
    try {
      await installAndRelaunch(result.info, setProgress);
    } catch {
      setBusy(false); // install/relaunch failed; allow retry
    }
  };

  return (
    <div>
      <SectionTitle>Updates</SectionTitle>
      {import.meta.env.DEV && (
        <p className="text-[11px] text-gray-500 mb-3">
          Auto-update runs only in release builds; in dev the check always reports up-to-date.
        </p>
      )}
      <Row label="Application updates" hint="Downloaded from the official signed release">
        <button className={btn} onClick={check} disabled={checking || busy}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </Row>

      {result?.status === "current" && (
        <p className="text-[12px] text-textMuted">You're running the latest version.</p>
      )}
      {result?.status === "error" && (
        <p className="text-[12px] text-amber-300/80">
          Update check failed.
          <span className="block text-[10px] text-gray-500 mt-0.5 break-words">{result.message}</span>
        </p>
      )}
      {result?.status === "available" && (
        <div className="rounded border border-accent/50 bg-accent/10 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-accent">Update available</span>
            <span className="text-textMuted">v{result.info.version}</span>
          </div>
          {result.info.notes && (
            <div className="text-[11px] text-textMuted max-h-32 overflow-auto whitespace-pre-wrap mb-2">
              {result.info.notes}
            </div>
          )}
          {busy ? (
            <div>
              <div className="h-1.5 rounded bg-button overflow-hidden">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="text-[10px] text-gray-500 mt-1">Downloading… {Math.round(progress * 100)}%</div>
            </div>
          ) : (
            <button
              className="px-2.5 py-1 rounded bg-accent/30 hover:bg-accent/40 border border-accent text-[11px]"
              onClick={install}
            >
              Install &amp; Restart
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<Category>("game");
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-12 -translate-x-1/2 w-[760px] max-h-[82vh] flex flex-col bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-2 border-b border-edge bg-panelHeader">
          <span className="font-semibold">Settings</span>
          <div className="flex-1" />
          <button className={btn} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="w-44 shrink-0 border-r border-edge py-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`w-full text-left px-3 py-1.5 text-[12px] ${
                  cat === c.id ? "bg-accent/20 text-accent border-l-2 border-accent" : "text-text hover:bg-panelAlt border-l-2 border-transparent"
                }`}
                onClick={() => setCat(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-auto p-4">
            {cat === "game" && <GameSection />}
            {cat === "keybinds" && <KeybindsSection />}
            {cat === "perspective" && <PerspectiveSection />}
            {cat === "visualizer" && <VisualizerSection />}
            {cat === "editor" && <EditorSection />}
            {cat === "theme" && <ThemeSection />}
            {cat === "about" && <UpdatesSection />}
          </div>
        </div>
      </div>
    </>
  );
}
