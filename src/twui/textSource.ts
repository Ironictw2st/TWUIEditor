// Where a component's static display text / tooltip comes from, per layout dialect,
// mirroring the engine's lookup (verified against games/3K and games/WH3 data):
//
// - 3K (<=136): on the STATE. Text = `uied_component_texts_localised_string_<textlabel>`
//   only when `textlocalised="true"`, else the literal `text`. Tooltip =
//   `…<tooltiplabel>` (state, then component) when a loc row exists, else the literal
//   state `tooltip`.
// - WH3 (142): a `<localised_texts><localised_text state="…">` row on the COMPONENT, matched
//   by state name (an empty `state` is the all-states default). `is_text_localised`
//   defaults to true; `tooltip_label` resolves the same way, `tooltip_text` is the literal.
//
// Returned strings are raw (entities decoded, `{{…}}`/`[[…]]` still present).

import { RawElement } from "../types/twui";
import { childByTag, elementChildren, getAttr } from "./doc";
import { UIED_TEXT } from "./richText";

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const uied = (label: string | undefined, loc?: Record<string, string>) =>
  label ? loc?.[UIED_TEXT + label] : undefined;

/** The WH3 `<localised_text>` row for a state (by name), else the all-states default. */
export function localisedTextRow(comp: RawElement, state: RawElement | undefined): RawElement | undefined {
  const lts = childByTag(comp, "localised_texts");
  if (!lts) return undefined;
  const rows = elementChildren(lts);
  const name = state ? getAttr(state, "name") : undefined;
  return (
    (name !== undefined ? rows.find((r) => getAttr(r, "state") === name) : undefined) ??
    rows.find((r) => !getAttr(r, "state"))
  );
}

/** Where a text string came from — drives the Inspector's "resolves to" hint. */
export interface TextOrigin {
  text: string | undefined;
  /** The loc key consulted (if any) and whether it hit. */
  key?: string;
  localised: boolean;
}

/** A state's static display text, before callbacks / inline tokens / markup. */
export function stateTextOrigin(comp: RawElement, state: RawElement | undefined, loc?: Record<string, string>): TextOrigin {
  if (state) {
    const raw = getAttr(state, "text");
    const label = getAttr(state, "textlabel");
    if (getAttr(state, "textlocalised") === "true" && label) {
      const v = uied(label, loc);
      if (v !== undefined) return { text: v, key: UIED_TEXT + label, localised: true };
      return { text: raw !== undefined ? decode(raw) : undefined, key: UIED_TEXT + label, localised: false };
    }
    if (raw !== undefined) return { text: decode(raw), localised: false };
  }
  const row = localisedTextRow(comp, state);
  if (row) {
    const raw = getAttr(row, "text");
    const label = getAttr(row, "text_label");
    if (getAttr(row, "is_text_localised") !== "false" && label) {
      const v = uied(label, loc);
      if (v !== undefined) return { text: v, key: UIED_TEXT + label, localised: true };
      return { text: raw !== undefined ? decode(raw) : undefined, key: UIED_TEXT + label, localised: false };
    }
    if (raw !== undefined) return { text: decode(raw), localised: false };
  }
  return { text: undefined, localised: false };
}

export function stateText(comp: RawElement, state: RawElement | undefined, loc?: Record<string, string>): string | undefined {
  return stateTextOrigin(comp, state, loc).text;
}

/** A component's static tooltip text for a state (loc first, then the literal). */
export function staticTooltipOrigin(comp: RawElement, state: RawElement | undefined, loc?: Record<string, string>): TextOrigin {
  let key: string | undefined;
  const labels = [state && getAttr(state, "tooltiplabel"), getAttr(comp, "tooltiplabel")];
  const row = localisedTextRow(comp, state);
  if (row) labels.push(getAttr(row, "tooltip_label"));
  for (const label of labels) {
    if (!label) continue;
    key ??= UIED_TEXT + label;
    const v = uied(label, loc);
    if (v) return { text: v, key: UIED_TEXT + label, localised: true };
  }
  const literal =
    (state && getAttr(state, "tooltip")) ||
    (state && getAttr(state, "tooltip_text")) ||
    getAttr(comp, "tooltip_text") ||
    (row && getAttr(row, "tooltip_text"));
  return { text: literal ? decode(literal) : undefined, key, localised: false };
}
