import { describe, it, expect } from "vitest";
import {
  parseExprTree,
  formatExpr,
  isMultiline,
  toLines,
  splitComponentRefs,
  serializeExpr,
  editModel,
  applyLeafEdits,
} from "./cco_format";
import { decodeEntities, encodeEntities } from "./cco";

/** Compact per-line render: indentation as leading dots (2 per depth), then the `let`
 *  binding marker / connective, then the text. */
function render(expr: string): string[] {
  return formatExpr(expr).map(
    (ln) =>
      `${".".repeat(ln.depth * 2)}${
        ln.binding ? "let " : ln.connective ? ln.connective + " " : ""
      }${ln.text}`
  );
}

describe("parseExprTree", () => {
  it("keeps a bare comparison as a single leaf", () => {
    expect(parseExprTree("a == b")).toEqual({ kind: "leaf", text: "a == b" });
  });

  it("splits top-level && into an and-node", () => {
    expect(parseExprTree("a && b && c")).toEqual({
      kind: "and",
      children: [
        { kind: "leaf", text: "a" },
        { kind: "leaf", text: "b" },
        { kind: "leaf", text: "c" },
      ],
    });
  });

  it("splits || above && (|| binds loosest, mirroring evalCondition)", () => {
    const tree = parseExprTree("a && b || c");
    expect(tree.kind).toBe("or");
    if (tree.kind === "or") {
      // Recursive parse trims each operand, so leaf text has no surrounding spaces.
      expect(tree.children[0]).toEqual({
        kind: "and",
        children: [
          { kind: "leaf", text: "a" },
          { kind: "leaf", text: "b" },
        ],
      });
      expect(tree.children[1]).toEqual({ kind: "leaf", text: "c" });
    }
  });

  it("strips redundant outer parens (nested)", () => {
    expect(parseExprTree("(((a && b)))")).toEqual(parseExprTree("a && b"));
  });
});

describe("isMultiline", () => {
  it("is false for a single leaf", () => {
    expect(isMultiline("IsContextValid(SpouseContext)")).toBe(false);
    expect(isMultiline("a == b")).toBe(false);
    expect(isMultiline("ExCanHaveTitle")).toBe(false);
  });
  it("is true when there is a top-level logical operator", () => {
    expect(isMultiline("a && b")).toBe(true);
    expect(isMultiline("a || b")).toBe(true);
  });
});

describe("formatExpr rendering", () => {
  it("breaks the sample compound condition with AND/OR + indentation", () => {
    const sample =
      '(PlayersFaction.SpecialPooledResourceBar == self.Id && TableValue.ValueForKey("x").Size > 0) || IsContextValid(SpouseContext)';
    expect(render(sample)).toEqual([
      "..PlayersFaction.SpecialPooledResourceBar == self.Id",
      "..AND TableValue.ValueForKey(\"x\").Size > 0",
      "OR IsContextValid(SpouseContext)",
    ]);
  });

  it("does not split inside string literals containing && / ||", () => {
    // The `||` lives inside "a||b" and must not break the line.
    expect(render('Loc("a||b") == x')).toEqual(['Loc("a||b") == x']);
  });

  it("leaves comparisons and + concatenation intact in a single leaf", () => {
    expect(render("a + b + c")).toEqual(["a + b + c"]);
    expect(render(">=")).toEqual([">="]); // degenerate, still one leaf
  });

  it("wraps a long single leaf as one line (ExprView handles visual wrap)", () => {
    const long = "Format(SomeVeryLongFunctionNameThatGoesOnAndOn(TableValue.ValueForKey(\"k\")))";
    const lines = formatExpr(long);
    expect(lines).toHaveLength(1);
    expect(lines[0].depth).toBe(0);
  });

  it("indents mixed-precedence subgroups", () => {
    // ((a||b) && c) || d — d at depth 0, the && group at depth 1, the || group at depth 2.
    expect(render("(a || b) && c || d")).toEqual([
      "....a",
      "....OR b",
      "..AND c",
      "OR d",
    ]);
  });
});

describe("toLines", () => {
  it("carries the group's incoming connective onto the first line of a subgroup", () => {
    const lines = toLines({
      kind: "or",
      children: [
        { kind: "leaf", text: "x" },
        { kind: "and", children: [{ kind: "leaf", text: "y" }, { kind: "leaf", text: "z" }] },
      ],
    });
    expect(lines).toEqual([
      { depth: 0, connective: undefined, text: "x" },
      { depth: 1, connective: "OR", text: "y" },
      { depth: 1, connective: "AND", text: "z" },
    ]);
  });
});

describe("lambda unwrapping", () => {
  it("splits a simple lambda into a binding + body", () => {
    expect(parseExprTree("( a = 1 ) => a")).toEqual({
      kind: "lambda",
      bindings: ["a = 1"],
      body: { kind: "leaf", text: "a" },
    });
    expect(render("( a = 1 ) => a")).toEqual(["let a = 1", "a"]);
  });

  it("emits one `let` line per comma-separated binding", () => {
    expect(render("( a = 1, b = 2 ) => a && b")).toEqual([
      "let a = 1",
      "let b = 2",
      "a",
      "AND b",
    ]);
  });

  it("strips the `{ }` body braces and breaks the body's AND/OR (yuan_shao_panel)", () => {
    const expr =
      '( L = Component("6C81F75E-2DA3-436F-8950E7247A33BF6E").CurrentSelection.SelectedObjectList )' +
      ' => { (L.Size > 0 && L.FirstContext.EffectBundleList( true ).Any( Key == StoredContext("CcoEffectBundle").Key))' +
      ' || PlayersFaction.EffectBundleList( true ).Any( Key == StoredContext("CcoEffectBundle").Key) }';
    const tree = parseExprTree(expr);
    expect(tree.kind).toBe("lambda");
    if (tree.kind === "lambda") {
      expect(tree.bindings).toEqual([
        'L = Component("6C81F75E-2DA3-436F-8950E7247A33BF6E").CurrentSelection.SelectedObjectList',
      ]);
      expect(tree.body.kind).toBe("or");
      if (tree.body.kind === "or") {
        expect(tree.body.children).toHaveLength(2);
        expect(tree.body.children[0].kind).toBe("and");
        expect(tree.body.children[1].kind).toBe("leaf");
      }
    }
    const lines = render(expr);
    expect(lines[0]).toBe(
      'let L = Component("6C81F75E-2DA3-436F-8950E7247A33BF6E").CurrentSelection.SelectedObjectList'
    );
    expect(lines[1]).toBe("..L.Size > 0");
    expect(lines[2]).toBe(
      '..AND L.FirstContext.EffectBundleList( true ).Any( Key == StoredContext("CcoEffectBundle").Key)'
    );
    expect(lines[3]).toBe(
      'OR PlayersFaction.EffectBundleList( true ).Any( Key == StoredContext("CcoEffectBundle").Key)'
    );
  });

  it("handles a lambda body without braces", () => {
    expect(render("( x = a ) => x == 1")).toEqual(["let x = a", "x == 1"]);
  });

  it("treats a lambda as multiline (renders the block)", () => {
    expect(isMultiline("( a = 1 ) => a")).toBe(true);
  });
});

describe("splitComponentRefs", () => {
  const GUID = "6C81F75E-2DA3-436F-8950E7247A33BF6E";
  it("splits a Component(guid) ref out of surrounding text", () => {
    expect(splitComponentRefs(`L = Component("${GUID}").CurrentSelection`)).toEqual([
      { kind: "text", text: "L = " },
      { kind: "ref", guid: GUID, raw: `Component("${GUID}")` },
      { kind: "text", text: ".CurrentSelection" },
    ]);
  });
  it("returns plain text unchanged", () => {
    expect(splitComponentRefs("L.Size > 0")).toEqual([{ kind: "text", text: "L.Size > 0" }]);
  });
  it("does not match non-guid string args like StoredContext", () => {
    expect(splitComponentRefs('StoredContext("CcoEffectBundle").Key')).toEqual([
      { kind: "text", text: 'StoredContext("CcoEffectBundle").Key' },
    ]);
  });
  it("is stateless across calls (no lastIndex leakage)", () => {
    const t = `Component("${GUID}")`;
    expect(splitComponentRefs(t)).toEqual(splitComponentRefs(t));
  });
});

describe("serializeExpr (tree -> compact)", () => {
  const YUAN =
    '( L = Component("6C81F75E-2DA3-436F-8950E7247A33BF6E").CurrentSelection.SelectedObjectList )' +
    ' => { (L.Size > 0 && L.FirstContext.EffectBundleList( true ).Any( Key == StoredContext("CcoEffectBundle").Key))' +
    ' || PlayersFaction.EffectBundleList( true ).Any( Key == StoredContext("CcoEffectBundle").Key) }';

  it("is a structural inverse of parseExprTree", () => {
    for (const x of ["a == b", "a && b || c", "(a || b) && c || d", YUAN]) {
      expect(parseExprTree(serializeExpr(parseExprTree(x)))).toEqual(parseExprTree(x));
    }
  });
  it("parenthesizes an or-group nested under an and", () => {
    expect(serializeExpr(parseExprTree("(a || b) && c"))).toBe("(a || b) && c");
    // and under or needs no parens (precedence)
    expect(serializeExpr(parseExprTree("a && b || c"))).toBe("a && b || c");
  });
  it("emits lambda braces", () => {
    expect(serializeExpr(parseExprTree("( x = 1 ) => x"))).toBe("( x = 1 ) => { x }");
  });
});

describe("editModel / applyLeafEdits (structured-editor guard)", () => {
  it("texts follow toLines order and round-trip with no edits", () => {
    const tree = parseExprTree("a && b || c");
    const { texts } = editModel(tree);
    expect(texts).toEqual(["a", "b", "c"]);
    expect(serializeExpr(applyLeafEdits(tree, texts))).toBe("a && b || c");
  });
  it("substitutes an edited leaf", () => {
    const tree = parseExprTree("a && b || c");
    expect(serializeExpr(applyLeafEdits(tree, ["a", "X", "c"]))).toBe("a && X || c");
  });
  it("edits a lambda binding + body leaf independently", () => {
    const tree = parseExprTree("( L = 1 ) => a && b");
    const { texts } = editModel(tree);
    expect(texts).toEqual(["L = 1", "a", "b"]);
    expect(serializeExpr(applyLeafEdits(tree, ["L = 2", "a", "b"]))).toBe("( L = 2 ) => { a && b }");
  });
});

describe("round-trip invariant (formatter is display-only)", () => {
  // The pretty view decodes for display only; the stored value round-trips through
  // encode/decode unchanged. These are the exact escape forms funcIds are stored in.
  const stored = [
    "a &amp;&amp; b",
    "x &gt;= 1 &amp;&amp; y &lt; 2",
    "Loc(&quot;key&quot;) == z",
    "(a &amp;&amp; b) || c",
  ];
  it("encode(decode(raw)) === raw for representative funcIds", () => {
    for (const raw of stored) {
      expect(encodeEntities(decodeEntities(raw))).toBe(raw);
    }
  });
  it("formatting reads the decoded form without mutating the stored string", () => {
    for (const raw of stored) {
      const decoded = decodeEntities(raw);
      formatExpr(decoded); // no throw, no side effect
      expect(encodeEntities(decoded)).toBe(raw); // stored value still reconstructs byte-for-byte
    }
  });
});
