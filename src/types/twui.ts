// Mirror of the Rust `model` DTO. The document is a fidelity-preserving raw
// element tree; both <hierarchy> and <components> are subtrees of `root`.

export type Attr = [string, string];

export interface RawElement {
  kind: "element";
  tag: string;
  attrs: Attr[];
  children: TwuiNode[];
  self_closing: boolean;
}

export interface RawComment {
  kind: "comment";
  text: string;
}

export type TwuiNode = RawElement | RawComment;

export interface TwuiDocument {
  prolog: string[];
  root: RawElement; // the <layout> element
}

export function isElement(n: TwuiNode): n is RawElement {
  return n.kind === "element";
}

export interface RoundtripReport {
  identical: boolean;
  original_len: number;
  output_len: number;
  first_diff?: {
    byte_offset: number;
    original_excerpt: string;
    output_excerpt: string;
  };
}

export interface ImageStatus {
  resolved: boolean;
  absolute: boolean;
  exists: boolean;
  kind: string;
}

export interface Faction {
  key: string;
  screen_name: string;
  subculture: string;
  flags_path: string;
}

export interface Subculture {
  subculture: string;
  culture: string;
}

export interface ContextDb {
  factions: Faction[];
  subcultures: Subculture[];
  cultures: string[];
  campaigns: string[];
  campaign_factions: Record<string, string[]>;
}

export interface FactionContext {
  campaign: string;
  faction: string;
  culture: string;
  subculture: string;
}

/** A character generation template + its resolved adult portrait folder + unitcard. */
export interface CharacterTemplate {
  key: string;
  /** Portrait folder prefix, e.g. `3k_dlc06_hero_special_king_wutugu/` (may be empty). */
  portrait: string;
  /** Unitcard image name (arts `card` column), e.g. `3k_dlc06_hero_special_king_wutugu`. */
  card: string;
}

export interface CharacterDb {
  templates: CharacterTemplate[];
}

/** A CCO function's signature from the UI documentation (Inspector hints). */
export interface CcoFunc {
  ret: string;
  args: string;
  desc: string;
}

/** CCO symbol table: object name -> (function name -> definition). */
export interface CcoDocs {
  objects: Record<string, Record<string, CcoFunc>>;
}

/** One clause of a `select`-form shorthand macro (a clause with no `cond` is the default). */
export interface ShorthandClause {
  cond: string | null;
  ret: string;
}

/** A content-defined CCO shorthand macro (`ui/cco/*.json`): a named expression. */
export interface ShorthandDef {
  name: string;
  /** Direct return expression (simple form); null for a `select` macro. */
  ret: string | null;
  /** Conditional clauses (the `select` form); empty for the simple form. */
  select: ShorthandClause[];
}

/** Shorthand macro registry: cco type (lowercased file stem) -> (macro name -> def). */
export interface CcoShorthand {
  objects: Record<string, Record<string, ShorthandDef>>;
}
