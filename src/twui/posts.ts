// Resolve a court office's display title. The slot's id is a `ministerial_position_key`;
// the ministerial-positions table (loaded into the ContextDb) holds one title variant per
// cultural row. We pick the variant that best matches the selected perspective rather than
// hardcoding the eight Han office names, so it works for any faction/government.

import { FactionContext, MinisterialPosition } from "../types/twui";

/**
 * Best title for `positionKey` under the selected `ctx`. Scoring prefers, in order:
 * our faction's own row, then subculture, then culture; a faction-specific row that is
 * NOT ours is penalised (it would show the wrong flavour); the generic (no-faction) row
 * and a matching/empty campaign are nudged up. Returns undefined when no variant has a title.
 */
export function postTitle(
  positionKey: string,
  ctx: FactionContext | undefined,
  positions: MinisterialPosition[] | undefined,
  loc?: Record<string, string>
): string | undefined {
  if (!positions || !positionKey) return undefined;
  const cands = positions.filter((p) => p.position_key === positionKey && p.title);
  if (!cands.length) return undefined;

  const score = (p: MinisterialPosition): number => {
    let s = 0;
    if (p.faction) s += ctx?.faction && p.faction === ctx.faction ? 100 : -50;
    if (ctx?.subculture && p.subculture === ctx.subculture) s += 20;
    if (ctx?.culture && p.culture === ctx.culture) s += 10;
    if (!p.campaign || (ctx?.campaign && p.campaign === ctx.campaign)) s += 5;
    return s;
  };
  const best = [...cands].sort((a, b) => score(b) - score(a))[0].title;
  // Titles may embed a `{{tr:key}}` loc reference (e.g. prime_minister); resolve it.
  return loc
    ? best.replace(/\{\{tr:([^}]+)\}\}/gi, (m, k) => loc[k] ?? m)
    : best;
}
