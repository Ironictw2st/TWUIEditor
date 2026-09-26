// In-game text resolution shared by component text and tooltips. The game runs every
// displayed string through the same pipeline:
//   1. `{{tr:key}}` UI text replacements  -> `ui_text_replacements_localised_text_<key>`
//   2. escaped newlines in loc text (`\n`, stored as `\\n` in the TSV export)
//   3. `[[…]]` markup: `[[col:<ui_colours key|hex>]]…[[/col]]`, `[[b]]`, `[[i]]`,
//      `[[img:<ui_tagged_images key>]][[/img]]`
// then lays the styled runs out, word-wrapping when the state asks for it. Pure (no DOM):
// the caller supplies the text measurer, so the layout pass and the canvas agree.

/** Loc prefix for component `textlabel` / `tooltiplabel` strings (UIEd-authored). */
export const UIED_TEXT = "uied_component_texts_localised_string_";
/** Loc prefix for `{{tr:key}}` replacements. */
export const TEXT_REPLACEMENT = "ui_text_replacements_localised_text_";

export interface TextRun {
  text: string;
  /** CSS colour; undefined = the component's font colour. */
  colour?: string;
  bold?: boolean;
  italic?: boolean;
}
export interface ImageRun {
  /** Data-root-relative image path. */
  img: string;
}
export type Run = TextRun | ImageRun;

export const isImageRun = (r: Run): r is ImageRun => "img" in r;

/** Markup lookup tables (from the ContextDb). */
export interface MarkupTables {
  colours?: Record<string, string>;
  images?: Record<string, string>;
}

/** Expand `{{tr:key}}` replacements (recursively, a replacement may hold another).
 *  An unknown key is left verbatim so the author can see what failed to resolve. */
export function expandTextReplacements(s: string, loc?: Record<string, string>, depth = 0): string {
  if (!s.includes("{{tr:") || depth > 8) return s;
  return s.replace(/\{\{tr:([^}]*)\}\}/g, (m, key: string) => {
    const v = loc?.[TEXT_REPLACEMENT + key.trim()];
    return v === undefined ? m : expandTextReplacements(v, loc, depth + 1);
  });
}

/** Loc text stores line breaks as escaped `\n` (one or more backslashes). */
export function normaliseNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\\+n/g, "\n");
}

/** Full loc-string resolution short of markup parsing. */
export function resolveLocText(s: string, loc?: Record<string, string>): string {
  return normaliseNewlines(expandTextReplacements(s, loc));
}

// `[[/]]` (empty name) is a generic closer: it ends the most recently opened tag.
const TAG = /\[\[(\/?)([A-Za-z_]*)(?::([^\]]*))?\]\]/g;

/** A markup colour: a ui_colours key, else a hex literal (`FF4810`, `#FF4810`, `#FF4810FF`). */
export function markupColour(v: string, colours?: Record<string, string>): string | undefined {
  const key = v.trim();
  const named = colours?.[key];
  if (named) return named;
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(key);
  return m ? cssColour("#" + m[1] + (m[2] ?? "")) : undefined;
}

/** `#RRGGBBAA` (TWUI font colours) -> a CSS colour honouring the alpha. */
export function cssColour(c: string | undefined, fallback = "#ffffff"): string {
  if (!c || c[0] !== "#") return fallback;
  const hex = c.slice(1);
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    const a = parseInt(hex.slice(6, 8), 16);
    if (a === 255) return "#" + hex.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
  }
  return /^[0-9a-fA-F]{6}$/.test(hex) ? c : fallback;
}

/** True if a string carries any `[[…]]` markup tag. */
export function hasMarkup(s: string): boolean {
  return /\[\[\/?[A-Za-z_]*(?::[^\]]*)?\]\]/.test(s);
}

/**
 * Split marked-up text into styled runs. Colour tags nest (a stack); `[[b]]`/`[[i]]` are
 * counted so unbalanced closers can't go negative. `[[img:key]]` becomes an image run
 * (anything up to its `[[/img]]` is ignored, as in game). Unknown tags are dropped.
 */
export function parseMarkup(s: string, tables: MarkupTables = {}): Run[] {
  const runs: Run[] = [];
  const colours: (string | undefined)[] = [];
  let bold = 0;
  let italic = 0;
  let inImg = false;
  let last = 0;
  // Opened style tags, innermost last (for the generic `[[/]]` closer).
  const open: string[] = [];

  const pushText = (text: string) => {
    if (!text || inImg) return;
    const run: TextRun = { text };
    const colour = colours.length ? colours[colours.length - 1] : undefined;
    if (colour) run.colour = colour;
    if (bold > 0) run.bold = true;
    if (italic > 0) run.italic = true;
    const prev = runs[runs.length - 1];
    if (prev && !isImageRun(prev) && prev.colour === run.colour && prev.bold === run.bold && prev.italic === run.italic)
      prev.text += text;
    else runs.push(run);
  };

  for (const m of s.matchAll(TAG)) {
    pushText(s.slice(last, m.index));
    last = m.index! + m[0].length;
    const closing = m[1] === "/";
    let tag = m[2].toLowerCase();
    const arg = m[3];
    if (!tag) {
      if (!closing) continue;
      tag = open[open.length - 1] ?? "";
    }
    if (tag === "col" || tag === "b" || tag === "i") {
      if (!closing) open.push(tag);
      else {
        const at = open.lastIndexOf(tag);
        if (at >= 0) open.splice(at, 1);
      }
    }
    switch (tag) {
      case "col":
        if (closing) colours.pop();
        else colours.push(arg !== undefined ? markupColour(arg, tables.colours) : undefined);
        break;
      case "b":
        bold = closing ? Math.max(0, bold - 1) : bold + 1;
        break;
      case "i":
        italic = closing ? Math.max(0, italic - 1) : italic + 1;
        break;
      case "img":
        if (closing) inImg = false;
        else {
          const key = (arg ?? "").trim();
          const path = tables.images?.[key] ?? (key.includes("/") ? key : undefined);
          if (path) runs.push({ img: path });
          inImg = true;
        }
        break;
    }
  }
  pushText(s.slice(last));
  return runs;
}

/** The runs' plain text (images dropped) — for measuring, search and hit labels. */
export function plainText(runs: Run[]): string {
  return runs.map((r) => (isImageRun(r) ? "" : r.text)).join("");
}

/** A run positioned on a line: x offset from the line start + its advance. */
export interface PlacedRun {
  run: Run;
  x: number;
  width: number;
}
export interface TextLine {
  runs: PlacedRun[];
  width: number;
}

/** Measure `text` in the component font with a run's bold/italic applied. */
export type RunMeasurer = (text: string, style: { bold?: boolean; italic?: boolean }) => number;

/**
 * Lay runs out into lines. Hard newlines always break. With `maxWidth` set (the state
 * wraps: "Split by word"/"Split by character"), text greedily wraps at word (or character)
 * boundaries; a word longer than the line is kept whole rather than dropped. Image runs
 * occupy `imageSize` px.
 */
export function layoutRuns(
  runs: Run[],
  measure: RunMeasurer,
  imageSize: number,
  maxWidth?: number,
  splitByChar = false
): TextLine[] {
  const lines: TextLine[] = [{ runs: [], width: 0 }];
  const cur = () => lines[lines.length - 1];
  const newLine = () => {
    const l = cur();
    // Trailing spaces don't count toward alignment width.
    const tail = l.runs[l.runs.length - 1];
    if (tail && !isImageRun(tail.run) && /\s+$/.test(tail.run.text)) {
      const trimmed = tail.run.text.replace(/\s+$/, "");
      const w = trimmed ? measure(trimmed, tail.run) : 0;
      l.width -= tail.width - w;
      if (trimmed) {
        tail.run = { ...tail.run, text: trimmed };
        tail.width = w;
      } else l.runs.pop();
    }
    lines.push({ runs: [], width: 0 });
  };
  const place = (run: Run, width: number) => {
    const l = cur();
    const prev = l.runs[l.runs.length - 1];
    // Merge adjacent same-style text pieces back together (fewer draw calls).
    if (prev && !isImageRun(prev.run) && !isImageRun(run) && prev.x + prev.width === l.width &&
        prev.run.colour === run.colour && prev.run.bold === run.bold && prev.run.italic === run.italic) {
      prev.run = { ...prev.run, text: prev.run.text + run.text };
      prev.width += width;
    } else l.runs.push({ run, x: l.width, width });
    l.width += width;
  };
  const fits = (w: number) => maxWidth === undefined || cur().width + w <= maxWidth + 0.5 || cur().runs.length === 0;

  for (const run of runs) {
    if (isImageRun(run)) {
      if (!fits(imageSize)) newLine();
      place(run, imageSize);
      continue;
    }
    run.text.split("\n").forEach((para, pi) => {
      if (pi > 0) newLine();
      if (!para) return;
      if (maxWidth === undefined) {
        place({ ...run, text: para }, measure(para, run));
        return;
      }
      const pieces = splitByChar ? Array.from(para) : para.match(/\s+|\S+/g) ?? [];
      for (const piece of pieces) {
        const w = measure(piece, run);
        const space = /^\s+$/.test(piece);
        if (!fits(w)) {
          if (space) continue; // a break swallows the space it happens at
          newLine();
        }
        if (space && cur().runs.length === 0) continue; // no leading space on a wrapped line
        place({ ...run, text: piece }, w);
      }
    });
  }
  return lines;
}
