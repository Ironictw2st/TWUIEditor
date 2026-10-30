// Display-only pretty-formatter for CCO condition expressions. Breaks a compound
// funcId condition at its top-level logical operators so a human can read the logic
// instead of scrolling a single long line off the panel edge.
//
// This is STRICTLY a rendering aid: it never feeds any setter. The editable field
// keeps committing the exact decoded string (re-encoded on write), so byte-identical
// round-trip is unaffected.
//
// Precedence mirrors `evalCondition` (cco.ts): `||` binds loosest, then `&&`. Those two
// operators split; a top-level lambda `( a = e ) => { body }` is unwrapped into its
// binding(s) + body (mirroring `evalExpr`). Everything else — comparisons (`==`/`>=`/…),
// `+` concatenation, `,` argument lists — stays intact inside a single leaf (and wraps on
// its own if long). The splitters are quote/paren-aware, so operators inside string
// literals or nested calls are never mistaken for a top-level break.

import { splitTop, isWrapped } from "./cco";

export type ExprNode =
  | { kind: "and" | "or"; children: ExprNode[] }
  | { kind: "lambda"; bindings: string[]; body: ExprNode }
  | { kind: "leaf"; text: string };

export interface ExprLine {
  /** Nesting level — each parenthesized subgroup indents one step. */
  depth: number;
  /** The logical operator joining this operand to the previous one in its group
   *  (absent on the first operand of a group / a lone leaf). */
  connective?: "AND" | "OR";
  /** A lambda parameter assignment (`L = …`), shown as dimmed context, not a condition. */
  binding?: boolean;
  /** A single comparison / call / identifier, trimmed. */
  text: string;
}

/**
 * Parse a DECODED expression into an and/or tree. Strips redundant outer parens,
 * then splits top-level `||`, then `&&`; anything else is one leaf. Never throws —
 * malformed input (e.g. unbalanced parens) simply falls through to a single leaf.
 */
export function parseExprTree(expr: string): ExprNode {
  let e = expr.trim();
  while (isWrapped(e)) e = e.slice(1, -1).trim();

  // Lambda `( a = e1, b = e2 ) => body` (body often wrapped in `{ }`): surface the
  // binding(s) as context and format the body's condition tree. Mirrors evalExpr's
  // arrow handling (cco.ts) — the `(...)` guard avoids matching a stray `=>`.
  const arrow = splitTop(e, "=>");
  if (arrow.length >= 2 && arrow[0].trim().startsWith("(") && arrow[0].trim().endsWith(")")) {
    const params = arrow[0].trim().slice(1, -1);
    let body = arrow.slice(1).join("=>").trim();
    if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1).trim();
    const bindings = splitTop(params, ",").map((s) => s.trim()).filter(Boolean);
    return { kind: "lambda", bindings, body: parseExprTree(body) };
  }

  const ors = splitTop(e, "||");
  if (ors.length > 1) return { kind: "or", children: ors.map(parseExprTree) };

  const ands = splitTop(e, "&&");
  if (ands.length > 1) return { kind: "and", children: ands.map(parseExprTree) };

  return { kind: "leaf", text: e };
}

/** Flatten the tree into indented, connective-prefixed render lines. */
export function toLines(node: ExprNode, depth = 0, connective?: "AND" | "OR"): ExprLine[] {
  if (node.kind === "leaf") return [{ depth, connective, text: node.text }];
  if (node.kind === "lambda") {
    const out: ExprLine[] = node.bindings.map((b) => ({ depth, binding: true, text: b }));
    out.push(...toLines(node.body, depth, connective));
    return out;
  }
  const op = node.kind === "and" ? "AND" : "OR";
  const out: ExprLine[] = [];
  node.children.forEach((child, i) => {
    // The first operand carries the group's incoming connective; the rest carry this
    // node's operator. A parenthesized subgroup indents one step.
    const conn = i === 0 ? connective : op;
    if (child.kind === "leaf") out.push({ depth, connective: conn, text: child.text });
    else out.push(...toLines(child, depth + 1, conn));
  });
  return out;
}

/** Convenience: decoded string → render lines. */
export function formatExpr(expr: string): ExprLine[] {
  return toLines(parseExprTree(expr));
}

/** True iff the expr has a top-level `&&`/`||` or is a lambda (i.e. formatting yields
 *  >1 line), so call sites can skip the pretty block for trivial single-leaf expressions. */
export function isMultiline(expr: string): boolean {
  const node = parseExprTree(expr);
  return node.kind !== "leaf";
}

/** Parenthesization precedence: `or` loosest, then `and`, `leaf` atomic; a `lambda`
 *  always wraps when nested inside a boolean operator. */
function prec(node: ExprNode): number {
  switch (node.kind) {
    case "or":
      return 1;
    case "and":
      return 2;
    case "leaf":
      return 3;
    case "lambda":
      return 0;
  }
}

/**
 * Serialize an expression tree back to a compact TWUI condition string — the inverse of
 * `parseExprTree`, up to whitespace/redundant-paren normalization. `parseExprTree(serializeExpr(t))`
 * is structurally equal to `t`. Leaf text (including `Component("<guid>")`) is emitted verbatim, so
 * no id->guid map is needed. The caller entity-encodes on write.
 */
export function serializeExpr(node: ExprNode): string {
  switch (node.kind) {
    case "leaf":
      return node.text;
    case "lambda":
      // Braces are the canonical CA form; parseExprTree strips them, so round-trip is stable.
      return `( ${node.bindings.join(", ")} ) => { ${serializeExpr(node.body)} }`;
    case "and":
    case "or": {
      const op = node.kind === "and" ? " && " : " || ";
      const min = node.kind === "and" ? 2 : 1; // wrap any child below this precedence
      return node.children
        .map((c) => (prec(c) < min ? `(${serializeExpr(c)})` : serializeExpr(c)))
        .join(op);
    }
  }
}

/** The per-line render model plus the initial editable text of each line (leaf text or
 *  lambda-binding string), in `toLines` order. Backs the structured editor. */
export function editModel(tree: ExprNode): { lines: ExprLine[]; texts: string[] } {
  const lines = toLines(tree);
  return { lines, texts: lines.map((l) => l.text) };
}

/** Clone `tree`, substituting each leaf's text and lambda binding with the corresponding
 *  entry of `texts` (same order `toLines`/`editModel` produce). Pure — enables the
 *  structured editor's commit + dirty-guard to be unit-tested without React. */
export function applyLeafEdits(tree: ExprNode, texts: string[]): ExprNode {
  let i = 0;
  const rec = (node: ExprNode): ExprNode => {
    switch (node.kind) {
      case "leaf":
        return { kind: "leaf", text: texts[i++] ?? node.text };
      case "lambda": {
        const bindings = node.bindings.map((b) => texts[i++] ?? b);
        return { kind: "lambda", bindings, body: rec(node.body) };
      }
      case "and":
      case "or":
        return { kind: node.kind, children: node.children.map(rec) };
    }
  };
  return rec(tree);
}

export type RefSeg = { kind: "text"; text: string } | { kind: "ref"; guid: string; raw: string };

/** TW3K component GUID form (8-4-4-16 hex) inside a `Component("…")` reference. */
const COMPONENT_REF = /Component\(\s*"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{16})"\s*\)/g;

/**
 * Split a line into verbatim text and `Component("<guid>")` reference segments, so the UI
 * can swap in the resolved component id while keeping the rest of the line byte-for-byte.
 * `raw` is the whole matched `Component("…")` substring (hover title / unresolved fallback).
 */
export function splitComponentRefs(text: string): RefSeg[] {
  const out: RefSeg[] = [];
  let last = 0;
  // A fresh regex per call keeps `lastIndex` state local (the module-level literal is stateful).
  const re = new RegExp(COMPONENT_REF.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "ref", guid: m[1], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
