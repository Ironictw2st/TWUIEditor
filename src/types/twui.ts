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

/** One cultural variant of a court office, with its resolved on-screen title. */
export interface MinisterialPosition {
  position_key: string;
  culture: string;
  faction: string;
  subculture: string;
  campaign: string;
  title: string;
}

export interface ContextDb {
  factions: Faction[];
  subcultures: Subculture[];
  cultures: string[];
  campaigns: string[];
  campaign_factions: Record<string, string[]>;
  ministerial_positions: MinisterialPosition[];
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

// --- DB-table preview binding (editor-only; never written to the .twui.xml) ---
//
// Lets the user attach a DB table to a container so the editor repeats the container's
// template child once per row and fills mapped descendant components from row columns.
// This previews runtime-populated panels (e.g. book_of_grudges) without simulating the
// game's bespoke panel callback. The config lives in persisted settings; resolved rows
// are session-only.

/** Maps a DB column onto one descendant component's text or image. */
export interface PreviewMapping {
  /** Target descendant component guid (the component's `this`/hierarchy guid). */
  target: string;
  /** Optional component `id` fallback (readability; guid wins when both are set). */
  targetId?: string;
  /** Which aspect of the target the column drives. */
  aspect: "text" | "image";
  /** DB column (header) name supplying the value. */
  column: string;
  /** Text only: "auto" (loc[value] else literal), "literal", or "loc". Default "auto". */
  resolve?: "auto" | "literal" | "loc";
  /** Optional "...{{value}}..." substitution (e.g. an image path prefix). */
  template?: string;
}

/** A user-defined preview binding (persisted in settings; no rows). */
export interface PreviewBindingConfig {
  /** Container component guid the table is attached to. */
  target: string;
  /** DB table name, e.g. "missions_tables". */
  table: string;
  /** Which child of the container is the repeated template (default 0). */
  templateIndex?: number;
  /** Preview row cap (default 50; hard-clamped at load). */
  limit?: number;
  /** Optional simple row filter. */
  filter?: { column: string; contains: string };
  /** Column -> component mappings. */
  mappings: PreviewMapping[];
}

/** A binding with its resolved rows attached (runtime; not persisted). */
export interface PreviewBinding extends PreviewBindingConfig {
  rows: { key: string; value: Record<string, string> }[];
}
