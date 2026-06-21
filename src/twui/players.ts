// Resolves the `PlayersFaction` static-object context (name + per-role character
// art) so DB-record bindings like `ToUpper(PlayersFaction.Name)` and character
// portraits render. General: driven by the perspective faction + the user's
// role->template assignments (see CharactersPanel), not any one panel.

import { CharacterDb, CharacterTemplate, ContextDb, FactionContext, TwuiDocument } from "../types/twui";
import { componentsSection, elementChildren, getAttr } from "./doc";
import { callbacks } from "./cco";
import { LuaValue } from "./lua";

/**
 * A character's `ArtContext` — the fields TWUI bindings read off `CcoCampaignCharacter`/role art:
 * `portrait` (composite folder, for Character2DDisplayCreator) and `StillImagePath`/`CardImage`
 * (`"ui/characters/" + StillImagePath + "/unitcards/" + CardImage + ".png"`).
 */
export function artContextOf(t: CharacterTemplate): Record<string, LuaValue> {
  // portrait ends in `/`, so `<portrait>stills` = e.g. `…king_wutugu/stills`.
  return { portrait: t.portrait, StillImagePath: t.portrait + "stills", CardImage: t.card };
}

/**
 * Build the `{ PlayersFaction: … }` var bag injected into the binding scope, plus a
 * `__roleArt` map (slot/role/office key → ArtContext) used by character lists + portraits.
 * - `Name`/`Key`/`*RecordContext.Key` come from the perspective faction.
 * - each assigned slot gets an `ArtContext` from its character template.
 */
export function buildPlayersContext(
  ctx: FactionContext | undefined,
  contextDb: ContextDb | null,
  loc: Record<string, string> | undefined,
  characters: Record<string, string>,
  characterDb: CharacterDb | null
): Record<string, LuaValue> {
  const factionKey = ctx?.faction ?? "";
  const faction = contextDb?.factions.find((f) => f.key === factionKey);
  const name = faction ? loc?.[faction.screen_name] ?? faction.screen_name : factionKey;

  const pf: Record<string, LuaValue> = {
    Name: name,
    Key: factionKey,
    SubcultureRecordContext: { Key: ctx?.subculture ?? "" },
    CultureRecordContext: { Key: ctx?.culture ?? "" },
    FactionRecordContext: { Key: factionKey },
  };

  // slot key -> ArtContext. PlayersFaction.<Role>Context roles are also injected as a
  // record on `pf`; office-post / CQI keys are read from `__roleArt` by compute.
  const roleArt: Record<string, LuaValue> = {};
  for (const [role, tmplKey] of Object.entries(characters)) {
    if (!tmplKey) continue;
    const t = characterDb?.templates.find((tt) => tt.key === tmplKey);
    if (!t || !t.portrait) continue;
    const art = artContextOf(t);
    pf[role] = { ArtContext: art, Name: tmplKey };
    roleArt[role] = art;
  }

  return { PlayersFaction: pf, __roleArt: roleArt };
}

/**
 * The character slots a screen references, e.g. `FactionLeaderContext`, a CQI key, or
 * a court **office key**. Drives the Characters panel's assignable slots. Three styles:
 * - `PlayersFaction.<Role>Context.ArtContext` → role = the Context name,
 * - `CharactersForCQIs(TableValue.ValueForKey("<key>")).…ArtContext` → role = the CQI key,
 * - `GovermentPostForKey(self.Id)` (a court post) → role = the component's `id`.
 */
export function referencedCharacterRoles(doc: TwuiDocument): string[] {
  const roles = new Set<string>();
  const patterns = [
    /PlayersFaction\.(\w+Context)\.ArtContext/g,
    /CharactersForCQIs\(\s*TableValue\.ValueForKey\("([^"]+)"\)\s*\)/g,
  ];
  const comps = componentsSection(doc);
  if (!comps) return [];
  for (const comp of elementChildren(comps)) {
    for (const cb of callbacks(comp)) {
      if (!cb.funcId) continue;
      // Office post: GovermentPostForKey(self.Id) -> role = the box's id.
      if (/GovermentPostForKey\(\s*self\.Id\s*\)/.test(cb.funcId)) {
        const id = getAttr(comp, "id");
        if (id) roles.add(id);
      }
      // Only CQI lookups that ultimately read ArtContext are character roles.
      const isArt = cb.funcId.includes("ArtContext");
      for (const re of patterns) {
        if (re.source.includes("CharactersForCQIs") && !isArt) continue;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cb.funcId)) !== null) roles.add(m[1]);
      }
    }
  }
  return [...roles];
}

/** CQI key referenced by a Character2DDisplayCreator propagator funcId, if any. */
export function cqiRoleOf(funcId: string): string | undefined {
  const m = /CharactersForCQIs\(\s*TableValue\.ValueForKey\("([^"]+)"\)\s*\)/.exec(funcId);
  return m?.[1];
}

/**
 * The on-disk composite portrait for a Character2DDisplayCreator: a `portrait`
 * folder prefix + the component's `character_size_type` (large_panel/small_panel),
 * `norm` emotion. Loads through the twuiimg:// protocol.
 */
export function portraitImagePath(portrait: string, sizeType: string): string {
  const folder = portrait.endsWith("/") ? portrait : portrait + "/";
  return `ui/characters/${folder}composites/${sizeType}/norm/norm.png`;
}
