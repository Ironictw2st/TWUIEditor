import { describe, it, expect } from "vitest";
import { CcoDocs } from "../types/twui";
import { rootType, resolveChainType, memberCompletions, rootCompletions, TypeCtx } from "./cco_types";

const f = (ret: string, list = false, desc = "") => ({ ret, list, args: "Void", desc });

const DOCS: CcoDocs = {
  objects: {
    CcoCampaignFaction: {
      FactionLeaderContext: f("CcoCampaignCharacter"),
      ActiveMissionList: f("CcoCampaignMission", true),
      Name: f("String"),
    },
    CcoCampaignCharacter: {
      IsFactionLeader: f("Bool"),
      Name: f("String"), // overloaded member name (also on Faction)
      Faction: f("CcoCampaignFaction"),
    },
    CcoCampaignMission: { Key: f("String") },
  },
  globals: {
    PlayersFaction: f("CcoCampaignFaction"),
    CampaignRoot: f("CcoCampaignRoot"),
    Component: f("CcoComponent"),
  },
};
const ctx: TypeCtx = { docs: DOCS };

describe("rootType", () => {
  it("resolves documented globals", () => {
    expect(rootType("PlayersFaction", ctx)).toBe("CcoCampaignFaction");
    expect(rootType("Component", ctx)).toBe("CcoComponent");
  });
  it("resolves self/this to the callback context type", () => {
    expect(rootType("self", { docs: DOCS, selfType: "CcoCampaignCharacter" })).toBe("CcoCampaignCharacter");
    expect(rootType("this", { docs: DOCS, selfType: "CcoCampaignCharacter" })).toBe("CcoCampaignCharacter");
  });
  it("terminates on TableValue / unknown", () => {
    expect(rootType("TableValue", ctx)).toBeUndefined();
    expect(rootType("Nope", ctx)).toBeUndefined();
  });
});

describe("resolveChainType", () => {
  it("walks a member chain from a global root", () => {
    expect(resolveChainType(["PlayersFaction", "FactionLeaderContext"], ctx)).toEqual({
      type: "CcoCampaignCharacter",
      isList: false,
    });
  });
  it("carries list-ness and collapses/keeps it via FirstContext/Filter", () => {
    expect(resolveChainType(["PlayersFaction", "ActiveMissionList"], ctx)).toEqual({
      type: "CcoCampaignMission",
      isList: true,
    });
    expect(resolveChainType(["PlayersFaction", "ActiveMissionList", "FirstContext"], ctx)).toEqual({
      type: "CcoCampaignMission",
      isList: false,
    });
    expect(resolveChainType(["PlayersFaction", "ActiveMissionList", "Filter"], ctx)).toEqual({
      type: "CcoCampaignMission",
      isList: true,
    });
  });
  it("Size -> Int, ValueForKey -> terminates", () => {
    expect(resolveChainType(["PlayersFaction", "ActiveMissionList", "Size"], ctx)).toEqual({
      type: "Int",
      isList: false,
    });
    expect(resolveChainType(["PlayersFaction", "ValueForKey"], ctx)).toEqual({
      type: undefined,
      isList: false,
    });
  });
  it("seeds from selfType when the first segment is a plain member", () => {
    expect(resolveChainType(["Faction"], { docs: DOCS, selfType: "CcoCampaignCharacter" })).toEqual({
      type: "CcoCampaignFaction",
      isList: false,
    });
  });
  it("terminates on an undocumented type", () => {
    expect(resolveChainType(["PlayersFaction", "Name", "Anything"], ctx)).toEqual({
      type: undefined,
      isList: false,
    });
  });
});

describe("memberCompletions", () => {
  it("lists a type's members, prefix-filtered and scoped (overloads not leaked)", () => {
    const names = memberCompletions("CcoCampaignFaction", "", ctx).map((c) => c.name);
    expect(names).toContain("FactionLeaderContext");
    expect(names).toContain("ActiveMissionList");
    expect(names).not.toContain("IsFactionLeader"); // that's a Character member
    expect(memberCompletions("CcoCampaignFaction", "Fact", ctx).map((c) => c.name)).toEqual([
      "FactionLeaderContext",
    ]);
  });
  it("surfaces return type + list flag", () => {
    const m = memberCompletions("CcoCampaignFaction", "ActiveMission", ctx)[0];
    expect(m).toMatchObject({ name: "ActiveMissionList", ret: "CcoCampaignMission", list: true });
  });
  it("falls back to all member names when the type is unknown", () => {
    const names = memberCompletions(undefined, "Name", ctx).map((c) => c.name);
    expect(names).toEqual(["Name"]);
  });
  it("is empty when docs are absent", () => {
    expect(memberCompletions("CcoCampaignFaction", "", { docs: null })).toEqual([]);
  });
});

describe("rootCompletions", () => {
  it("offers globals + engine roots", () => {
    const names = rootCompletions("", ctx).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["PlayersFaction", "CampaignRoot", "Component", "self", "this", "TableValue"]));
  });
  it("prefix-filters", () => {
    expect(rootCompletions("Play", ctx).map((c) => c.name)).toEqual(["PlayersFaction"]);
  });
  it("is empty when docs are absent", () => {
    expect(rootCompletions("", { docs: null })).toEqual([]);
  });
});
