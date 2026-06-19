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
