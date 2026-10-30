import { describe, it, expect } from "vitest";
import { attrsFor, schemaFor, validateAttr } from "./schema";

const S = (name: string, kind: Parameters<typeof schemaFor>[1], version = 136) => schemaFor(name, kind, version)!;

describe("engine overlay on 3K versions", () => {
  it("uses the game's default where the hand-made table guessed", () => {
    expect(S("sizetocontent", "layoutEngine").default).toBe("false");
    expect(S("sizetocontent", "layoutEngine", 142).default).toBe("true"); // WH3: table unchanged
    expect(S("width", "state").default).toBe("32");
    expect(S("textvalign", "state").default).toBe("Top");
  });

  it("uses the game's enum values (engine order)", () => {
    expect(S("horizontal_alignment", "layoutEngine").enumValues).toEqual(["Left", "Center", "Right"]);
    expect(S("texthbehaviour", "state").enumValues?.[0]).toBe("Slip by character");
  });

  it("reports how the game reads a value", () => {
    expect(validateAttr(S("visible", "component"), "True")).toMatch(/as false/);
    expect(validateAttr(S("visible", "component"), "t")).toMatch(/as true/);
    expect(validateAttr(S("visible", "component"), "false")).toBeNull();
    expect(validateAttr(S("texthbehaviour", "state"), "Split by character")).toMatch(/uses "Slip by character"/);
    expect(validateAttr(S("docking", "component"), "center")).toMatch(/case-sensitive: "Center"/);
    expect(validateAttr(S("width", "component_image"), "-4")).toMatch(/unsigned/);
    expect(validateAttr(S("priority", "component"), "1.5")).toMatch(/whole number/);
    expect(validateAttr(S("width", "state"), "+3")).toMatch(/cannot parse/);
    expect(validateAttr(S("width", "state"), "12.5")).toBeNull();
  });

  it("lists attributes the game reads that the table does not describe", () => {
    const extra = attrsFor("layoutEngine", 136).find((s) => s.name === "skew_angle");
    expect(extra?.category).toBe("Engine");
    expect(extra?.engine?.type).toBe("int");
    expect(attrsFor("layoutEngine", 142).some((s) => s.name === "skew_angle")).toBe(false);
  });

  it("carries the game's version range into the schema", () => {
    expect(S("min_dimensions", "layoutEngine", 136).versions).toEqual({ min: 131 });
    expect(attrsFor("component", 136).some((s) => s.name === "callbackid")).toBe(false);
  });

  it("accepts either type where engine readers of one kind disagree (spacing: list vs radial)", () => {
    const sp = S("spacing", "layoutEngine");
    expect(sp.engine?.type).toBe("vec2|float");
    expect(validateAttr(sp, "4.00,0.00")).toBeNull();
    expect(validateAttr(sp, "12.5")).toBeNull();
    expect(validateAttr(sp, "wide")).toMatch(/vec2 or float/);
  });
});
