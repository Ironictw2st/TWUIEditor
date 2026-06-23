import { ReactNode } from "react";
import { useStore } from "../state/store";

// The live perspective controls (campaign / faction / culture / subculture) plus background and the
// bounds toggle. Pulled out of the Visualizer's old "View & Perspective" bar so it can dock as its
// own collapsible panel and pop out into a separate window. All state lives in the store, so it
// mirrors across windows automatically.
export default function PerspectivePanel() {
  const context = useStore((s) => s.context);
  const db = useStore((s) => s.contextDb);
  const setCampaign = useStore((s) => s.setCampaign);
  const setFaction = useStore((s) => s.setFaction);
  const setCulture = useStore((s) => s.setCulture);
  const setSubculture = useStore((s) => s.setSubculture);
  const backgrounds = useStore((s) => s.backgrounds);
  const background = useStore((s) => s.background);
  const setBackground = useStore((s) => s.setBackground);
  const showBounds = useStore((s) => s.showBounds);
  const setShowBounds = useStore((s) => s.setShowBounds);

  const sel = "w-full bg-[#15161c] border border-edge rounded text-[11px] px-1.5 py-0.5";
  const lbl = "text-[10px] text-gray-500 uppercase tracking-wide";

  const hasDb = !!db && db.factions.length > 0;
  const campaignFactionKeys = db?.campaign_factions[context.campaign];
  const factionOptions =
    campaignFactionKeys && campaignFactionKeys.length
      ? campaignFactionKeys
      : db?.factions.map((f) => f.key) ?? [];

  const cell = (label: string, children: ReactNode) => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className={lbl}>{label}</span>
      {children}
    </div>
  );
  const textInput = (v: string, on: (s: string) => void) => (
    <input className={sel} value={v} onChange={(e) => on(e.target.value)} />
  );
  const selectFor = (value: string, onChange: (v: string) => void, options: string[]) => (
    <select className={sel} value={value} onChange={(e) => onChange(e.target.value)}>
      {!options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2">
      {cell("Campaign", hasDb ? selectFor(context.campaign, setCampaign, db!.campaigns) : textInput(context.campaign, setCampaign))}
      {cell("Faction", hasDb ? selectFor(context.faction, setFaction, factionOptions) : textInput(context.faction, setFaction))}
      {cell("Culture", hasDb ? selectFor(context.culture, setCulture, db!.cultures) : textInput(context.culture, setCulture))}
      {cell(
        "Subculture",
        hasDb ? selectFor(context.subculture, setSubculture, db!.subcultures.map((s) => s.subculture)) : textInput(context.subculture, setSubculture)
      )}
      {cell(
        "Background",
        <select className={sel} value={background ?? ""} onChange={(e) => setBackground(e.target.value || null)}>
          <option value="">No background</option>
          <option value="@white">White</option>
          <option value="@black">Black</option>
          {backgrounds.map((b) => (
            <option key={b} value={b}>
              {b.replace(/^background\//, "")}
            </option>
          ))}
        </select>
      )}
      {cell(
        "Bounds",
        <button
          className={`w-full px-1.5 py-0.5 rounded border text-[11px] ${
            showBounds ? "bg-accent/30 border-accent" : "bg-[#15161c] border-edge hover:bg-[#23252f]"
          }`}
          onClick={() => setShowBounds(!showBounds)}
        >
          {showBounds ? "On" : "Off"}
        </button>
      )}
    </div>
  );
}
