import { describe, it, expect } from "vitest";
import { caretChain } from "./cco_caret";

const at = (t: string) => caretChain(t, t.length);

describe("caretChain", () => {
  it("after a dot: full chain + empty prefix", () => {
    const t = "PlayersFaction.FactionLeaderContext.";
    expect(at(t)).toEqual({
      chain: "PlayersFaction.FactionLeaderContext",
      prefix: "",
      start: t.length,
      end: t.length,
      atRoot: false,
    });
  });
  it("mid identifier after a dot: chain + prefix", () => {
    const t = "PlayersFaction.Fac";
    expect(at(t)).toMatchObject({ chain: "PlayersFaction", prefix: "Fac", atRoot: false });
  });
  it("returns null inside a string literal", () => {
    expect(at('X == "ab')).toBeNull();
    expect(caretChain('Component("6C81F', 15)).toBeNull();
  });
  it("keeps balanced call args inside the chain", () => {
    expect(at("X.Filter(a==b).Z")).toMatchObject({ chain: "X.Filter(a==b)", prefix: "Z", atRoot: false });
  });
  it("root position when typing a bare token", () => {
    expect(at("Play")).toMatchObject({ chain: "", prefix: "Play", atRoot: true });
    expect(at("a && Play")).toMatchObject({ chain: "", prefix: "Play", atRoot: true });
  });
  it("handles a lambda-binding RHS chain (Component ref)", () => {
    const t = 'L = Component("g").Cur';
    expect(at(t)).toMatchObject({ chain: 'Component("g")', prefix: "Cur", atRoot: false });
  });
});
