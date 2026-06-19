// Heuristic faction "perspective" filter. True context-visibility is runtime
// DB/script-driven, so we approximate by matching a component's id against
// tokens derived from the DB faction/subculture keys. A component tagged with a
// faction/subculture token shows only when that token belongs to the selected
// context; an untagged component defers to its normal visibility flag.

import { ContextDb, FactionContext, RawElement } from "../types/twui";
import { childByTag, elementChildren, getAttr } from "./doc";

export interface ContextTokens {
  // token -> the owner key (faction or subculture/culture key) it belongs to
  byToken: Map<string, string>;
  // all tokens, longest first, for greedy matching
  ordered: string[];
}

function stripFaction(key: string): string {
  return key
    .replace(/^3k(_dlc\d+|_main)?_faction_/, "")
    .replace(/_separatists$/, "");
}

function stripSubculture(key: string): string {
  return key.replace(/^3k(_dlc\d+|_main)?_subculture_/, "").replace(/^3k_main_/, "");
}

/** Register a token (and trimmed suffixes) -> owner, keeping the first owner seen. */
function register(map: Map<string, string>, token: string, owner: string) {
  const segs = token.split("_").filter(Boolean);
  // full token plus progressively-trimmed leading segments (e.g.
  // "nanman_lady_zhurong" -> also "lady_zhurong" -> "zhurong")
  for (let start = 0; start < segs.length; start++) {
    const t = segs.slice(start).join("_");
    if (t.length >= 4 && !map.has(t)) map.set(t, owner);
  }
}

export function deriveTokens(db: ContextDb | null): ContextTokens {
  const byToken = new Map<string, string>();
  if (db) {
    for (const f of db.factions) register(byToken, stripFaction(f.key), f.key);
    for (const s of db.subcultures) register(byToken, stripSubculture(s.subculture), s.subculture);
  }
  const ordered = [...byToken.keys()].sort((a, b) => b.length - a.length);
  return { byToken, ordered };
}

/** The owner keys considered "selected" for the current context. */
function selectedOwners(ctx: FactionContext): Set<string> {
  return new Set([ctx.faction, ctx.subculture, ctx.culture].filter(Boolean));
}

function matchesId(id: string, token: string): boolean {
  return new RegExp(`(^|_)${token}(_|$)`).test(id);
}

export type ContextDecision = "show" | "hide" | "neutral";

/**
 * Decide a component's fate for the current perspective:
 *  - "neutral": not context-tagged -> use the normal visibility flag.
 *  - "show":   tagged and owned by the selected context -> force visible.
 *  - "hide":   tagged but owned by a different context -> force hidden.
 */
export function contextDecision(
  componentId: string | undefined,
  ctx: FactionContext,
  tokens: ContextTokens
): ContextDecision {
  if (!componentId || tokens.ordered.length === 0) return "neutral";
  const id = componentId.toLowerCase();
  const owners = selectedOwners(ctx);

  let tagged = false;
  for (const token of tokens.ordered) {
    if (!matchesId(id, token)) continue;
    tagged = true;
    const owner = tokens.byToken.get(token)!;
    if (owners.has(owner)) return "show";
  }
  return tagged ? "hide" : "neutral";
}

// Record-context keys a visibility condition can compare against the selected
// perspective. These are explicit and authoritative (unlike id-token matching).
const CONDITION_KEYS: { token: string; pick: (c: FactionContext) => string }[] = [
  { token: "CurrentCampaignKey", pick: (c) => c.campaign },
  { token: "SubcultureRecordContext\\.Key", pick: (c) => c.subculture },
  { token: "CultureRecordContext\\.Key", pick: (c) => c.culture },
  { token: "FactionRecordContext\\.Key", pick: (c) => c.faction },
];

/**
 * Condition-gated visibility. Components carry callbacks whose `context_function_id`
 * may compare a record-context key (campaign / subculture / culture / faction)
 * against a literal, e.g. `SubcultureRecordContext.Key == "3k_dlc06_subculture_nanman"`
 * or `CurrentCampaignKey != "8p_start_pos"`. Two callback kinds, OPPOSITE meaning:
 *   - ContextVisibilitySetter: VISIBLE when the condition is true.
 *   - ContextTrashOnCondition: REMOVED when the condition is true.
 * Returns "hide" when the selected perspective fails a single-condition gate;
 * compound (`||`) expressions are skipped. (Attr values are escaped: `&quot;`.)
 */
export function conditionDecision(comp: RawElement, ctx: FactionContext): ContextDecision {
  const lists = [
    childByTag(comp, "callbackwithcontextlist"),
    childByTag(comp, "callbacks_with_context"),
  ];
  for (const list of lists) {
    if (!list) continue;
    for (const cb of elementChildren(list)) {
      if (cb.tag !== "callback_with_context") continue;
      const id = getAttr(cb, "callback_id") ?? "";
      const isVisibility = /VisibilitySetter/i.test(id);
      const isTrash = /TrashOnCondition/i.test(id);
      if (!isVisibility && !isTrash) continue;
      const fn = getAttr(cb, "context_function_id");
      if (!fn || fn.includes("||")) continue; // ambiguous OR -> skip

      for (const { token, pick } of CONDITION_KEYS) {
        const eq = fn.match(new RegExp(`${token}\\s*==\\s*&quot;([^&]+)&quot;`));
        const ne = fn.match(new RegExp(`${token}\\s*!=\\s*&quot;([^&]+)&quot;`));
        const selected = pick(ctx);
        const conditionTrue = eq ? selected === eq[1] : ne ? selected !== ne[1] : undefined;
        if (conditionTrue === undefined) continue;

        // Visibility: visible iff condition true -> hide when false.
        // Trash:      removed  iff condition true -> hide when true.
        if (isVisibility && !conditionTrue) return "hide";
        if (isTrash && conditionTrue) return "hide";
      }
    }
  }
  return "neutral";
}
