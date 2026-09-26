import { describe, expect, it } from "vitest";
import {
  cssColour,
  expandTextReplacements,
  hasMarkup,
  layoutRuns,
  normaliseNewlines,
  parseMarkup,
  plainText,
  resolveLocText,
  TEXT_REPLACEMENT,
} from "./richText";

const loc = {
  [TEXT_REPLACEMENT + "advice_upkeep"]: "upkeep",
  [TEXT_REPLACEMENT + "outer"]: "a {{tr:advice_upkeep}} b",
  [TEXT_REPLACEMENT + "self"]: "{{tr:self}}",
};
const tables = {
  colours: { red: "#FF4810", flavour: "#C8AF6E" },
  images: { info_mode_icon: "ui/skins/default/icon_info.png" },
};

describe("text replacements + newlines", () => {
  it("expands {{tr:}} recursively and keeps unknown keys verbatim", () => {
    expect(expandTextReplacements("pay {{tr:advice_upkeep}}", loc)).toBe("pay upkeep");
    expect(expandTextReplacements("{{tr:outer}}", loc)).toBe("a upkeep b");
    expect(expandTextReplacements("{{tr:missing}}", loc)).toBe("{{tr:missing}}");
  });
  it("terminates on a self-referencing replacement", () => {
    expect(expandTextReplacements("{{tr:self}}", loc)).toBe("{{tr:self}}");
  });
  it("turns escaped newlines into real ones", () => {
    expect(normaliseNewlines("a\\\\nb\\nc\r\nd")).toBe("a\nb\nc\nd");
    expect(resolveLocText("{{tr:advice_upkeep}}\\n x", loc)).toBe("upkeep\n x");
  });
});

describe("markup", () => {
  it("parses nested colour, bold and italic", () => {
    const runs = parseMarkup("a [[col:red]]b [[b]]c[[/b]][[col:flavour]]d[[/col]][[/col]] [[i]]e[[/i]]", tables);
    expect(runs).toEqual([
      { text: "a " },
      { text: "b ", colour: "#FF4810" },
      { text: "c", colour: "#FF4810", bold: true },
      { text: "d", colour: "#C8AF6E" },
      { text: " " },
      { text: "e", italic: true },
    ]);
  });
  it("resolves hex colours and ignores unknown colour keys", () => {
    expect(parseMarkup("[[col:1BF520]]x[[/col]]")).toEqual([{ text: "x", colour: "#1BF520" }]);
    expect(parseMarkup("[[col:nope]]x[[/col]]")).toEqual([{ text: "x" }]);
  });
  it("turns [[img:key]] into an image run and drops unknown tags", () => {
    const runs = parseMarkup("press [[img:info_mode_icon]][[/img]] [[b]]info[[/b]][[foo]]!", tables);
    expect(runs).toEqual([
      { text: "press " },
      { img: "ui/skins/default/icon_info.png" },
      { text: " " },
      { text: "info", bold: true },
      { text: "!" },
    ]);
    expect(plainText(runs)).toBe("press  info!");
  });
  it("treats [[/]] as closing the innermost open tag", () => {
    expect(parseMarkup("[[b]]Luck[[/]] - rest", tables)).toEqual([{ text: "Luck", bold: true }, { text: " - rest" }]);
    expect(parseMarkup("[[col:red]][[b]]x[[/]]y[[/]]z", tables)).toEqual([
      { text: "x", colour: "#FF4810", bold: true },
      { text: "y", colour: "#FF4810" },
      { text: "z" },
    ]);
  });
  it("tolerates unbalanced closers", () => {
    expect(parseMarkup("[[/b]][[/col]]x")).toEqual([{ text: "x" }]);
  });
  it("detects markup", () => {
    expect(hasMarkup("plain [x]")).toBe(false);
    expect(hasMarkup("[[b]]x[[/b]]")).toBe(true);
  });
  it("converts #RRGGBBAA to CSS", () => {
    expect(cssColour("#FFFFFFFF")).toBe("#FFFFFF");
    expect(cssColour("#00000080")).toBe("rgba(0,0,0,0.502)");
    expect(cssColour("red")).toBe("#ffffff");
  });
});

describe("layoutRuns", () => {
  const measure = (t: string) => t.length * 10; // 10px per char
  const lineTexts = (lines: ReturnType<typeof layoutRuns>) =>
    lines.map((l) => l.runs.map((p) => ("img" in p.run ? "#" : p.run.text)).join("|"));

  it("keeps one line without a width limit, but honours hard newlines", () => {
    expect(lineTexts(layoutRuns([{ text: "hello world" }], measure, 12))).toEqual(["hello world"]);
    expect(lineTexts(layoutRuns([{ text: "a\nb" }], measure, 12))).toEqual(["a", "b"]);
  });
  it("wraps at word boundaries across styled runs", () => {
    const lines = layoutRuns([{ text: "aaa bbb " }, { text: "ccc ddd", bold: true }], measure, 12, 75);
    expect(lineTexts(lines)).toEqual(["aaa bbb", "ccc ddd"]);
    expect(lines[0].width).toBe(70);
    expect(lines[1].runs[0].run).toMatchObject({ bold: true });
  });
  it("keeps an over-long word whole", () => {
    expect(lineTexts(layoutRuns([{ text: "abcdefghij x" }], measure, 12, 50))).toEqual(["abcdefghij", "x"]);
  });
  it("splits by character when asked", () => {
    expect(lineTexts(layoutRuns([{ text: "abcdef" }], measure, 12, 30, true))).toEqual(["abc", "def"]);
  });
  it("places image runs inline", () => {
    const lines = layoutRuns([{ text: "a " }, { img: "x.png" }, { text: " b" }], measure, 12);
    expect(lineTexts(lines)).toEqual(["a |#| b"]);
    expect(lines[0].runs[1]).toMatchObject({ x: 20, width: 12 });
  });
});
