import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { referencedCharacterRoles, portraitImagePath, buildPlayersContext } from "../twui/players";
import { CharacterTemplate } from "../types/twui";
import { imageUrl } from "../ipc/commands";

/** `FactionLeaderContext` -> `Faction Leader`; `liu_yan_faction_leader_cqi` -> `liu yan faction leader cqi`. */
function roleLabel(role: string): string {
  return role
    .replace(/Context$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

/** Filterable template picker (typing narrows a datalist of template keys). */
function TemplatePicker({
  role,
  value,
  templates,
  onPick,
}: {
  role: string;
  value: string;
  templates: CharacterTemplate[];
  onPick: (key: string | null) => void;
}) {
  const [q, setQ] = useState(value);
  useEffect(() => setQ(value), [value, role]);
  const matches = useMemo(() => {
    const needle = q.toLowerCase();
    return templates.filter((t) => t.key.toLowerCase().includes(needle)).slice(0, 50);
  }, [q, templates]);
  return (
    <>
      <input
        className="flex-1 min-w-0"
        list={`tpl-${role}`}
        value={q}
        placeholder="search a character template…"
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value);
          onPick(e.target.value || null);
        }}
      />
      <datalist id={`tpl-${role}`}>
        {matches.map((t) => (
          <option key={t.key} value={t.key} />
        ))}
      </datalist>
    </>
  );
}

export default function CharactersPanel({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
  const doc = useStore((s) => s.doc);
  const context = useStore((s) => s.context);
  const contextDb = useStore((s) => s.contextDb);
  const characterDb = useStore((s) => s.characterDb);
  const characters = useStore((s) => s.characters);
  const setCharacter = useStore((s) => s.setCharacter);
  const loc = useStore((s) => s.loc);
  const imageEpoch = useStore((s) => s.imageEpoch);

  const roles = useMemo(() => (doc ? referencedCharacterRoles(doc) : []), [doc]);
  const templates = characterDb?.templates ?? [];
  const factionName = useMemo(
    () =>
      (buildPlayersContext(context, contextDb, loc, {}, characterDb).PlayersFaction as { Name?: string })
        ?.Name ?? context.faction,
    [context, contextDb, loc, characterDb]
  );

  const portraitFor = (role: string): string | null => {
    const key = characters[role];
    if (!key) return null;
    const t = templates.find((tt) => tt.key === key);
    return t?.portrait ? imageUrl(portraitImagePath(t.portrait, "large_panel"), imageEpoch) : null;
  };

  const body = (
    <>
      <div className="px-3 py-2 border-b border-edge">
        <span className="text-textMuted">Faction (from Perspective): </span>
        <span className="text-text">{factionName}</span>
      </div>

      <div className="px-3 py-3">
        {!doc ? (
            <div className="text-gray-500">Open a layout to assign its characters.</div>
          ) : !characterDb ? (
            <div className="text-gray-500">Character templates not loaded (this game has no DB data).</div>
          ) : roles.length === 0 ? (
            <div className="text-gray-500">This screen references no character portraits.</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-[11px] text-gray-500">
                Assign a character generation template to each role this screen renders. The portrait is
                resolved from the template's art set.
              </div>
              {roles.map((role) => (
                <div key={role} className="flex items-start gap-2">
                  <div className="w-12 h-12 shrink-0 bg-sunken border border-edge rounded overflow-hidden flex items-center justify-center">
                    {portraitFor(role) ? (
                      <img
                        src={portraitFor(role)!}
                        alt=""
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                    ) : (
                      <span className="text-[9px] text-gray-600">no art</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-text mb-1">{roleLabel(role)}</div>
                    <div className="flex items-center gap-1">
                      <TemplatePicker
                        role={role}
                        value={characters[role] ?? ""}
                        templates={templates}
                        onPick={(key) => setCharacter(role, key)}
                      />
                      {characters[role] && (
                        <button
                          className="px-1.5 py-0.5 rounded bg-button hover:bg-buttonHover border border-edge"
                          onClick={() => setCharacter(role, null)}
                          title="Clear"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    </>
  );

  if (embedded) return <div className="flex-1 min-h-0 overflow-auto">{body}</div>;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="fixed z-40 left-1/2 top-16 -translate-x-1/2 w-[520px] max-h-[75vh] overflow-auto bg-panel border border-edge rounded shadow-xl text-[12px]">
        <div className="px-3 h-9 flex items-center gap-2 border-b border-edge bg-panelHeader sticky top-0">
          <span className="font-semibold">Characters</span>
          <div className="flex-1" />
          <button className="text-textMuted hover:text-text text-[14px]" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        {body}
      </div>
    </>
  );
}
