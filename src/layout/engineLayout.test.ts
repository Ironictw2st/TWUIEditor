import { describe, it, expect } from "vitest";
import { childResize, dockCell, EngineImage, listLayout, redockOffset, resizeStateImages, roundAway } from "./engineLayout";

const img = (o: Partial<EngineImage>): EngineImage => ({
  w: 32, h: 32, ox: 0, oy: 0, dockOffset: [0, 0],
  canResizeWidth: true, canResizeHeight: true, isRelativeResize: false, isAspectRatioLocked: false, ...o,
});
const flags = { allowHorizontal: true, allowVertical: true, isRelativeResize: false, isAspectRatioLocked: false };

describe("dockCell (FUN_140565390 / FUN_140613d60)", () => {
  it("inner cells align inside the parent, truncated", () => {
    expect(dockCell("None", 100, 50, 10, 10)).toBeNull();
    expect(dockCell("Top Left", 100, 50, 10, 10)).toEqual([0, 0]);
    expect(dockCell("Center", 101, 51, 10, 10)).toEqual([45, 20]); // 45.5 / 20.5 truncate
    expect(dockCell("Bottom Right", 100, 50, 10, 10)).toEqual([90, 40]);
  });
  it("outer cells sit outside; corners outside on both axes", () => {
    expect(dockCell("Top Left External", 100, 50, 10, 20)).toEqual([-10, -20]);
    expect(dockCell("Bottom Right External", 100, 50, 10, 20)).toEqual([100, 50]);
    expect(dockCell("Center Left External", 100, 50, 10, 20)).toEqual([-10, 15]);
    expect(dockCell("Top Center External", 100, 50, 10, 20)).toEqual([45, -20]);
  });
  it("Center External is the plain centre; an unknown name is None", () => {
    expect(dockCell("Center External", 100, 50, 10, 10)).toEqual([45, 20]);
    expect(dockCell("center", 100, 50, 10, 10)).toBeNull();
  });
  it("matches a vanilla save (ai_turns: Top Right, 1200 state, 461 image, dock_offset -88 -> offset 651)", () => {
    const [x] = dockCell("Top Right", 1200, 0, 461, 0)!;
    expect(x - 88).toBe(651);
  });
});

describe("resizeStateImages (state SetSize FUN_14062e6d0)", () => {
  it("leaves images alone when the state keeps its size", () => {
    const a = [img({ ox: 7, oy: 9, dockpoint: "Center" })];
    expect(resizeStateImages(a, 40, 40, 40, 40)).toBe(a);
  });
  it("scales by new/old on resizable axes, then re-docks", () => {
    const [r] = resizeStateImages([img({ w: 20, h: 10, dockpoint: "Bottom Right", dockOffset: [-2, 0] })], 40, 20, 80, 20);
    expect([r.w, r.h]).toEqual([40, 10]);
    expect([r.ox, r.oy]).toEqual([80 - 40 - 2, 20 - 10]);
  });
  it("keeps a non-resizable axis and an undocked offset", () => {
    const [r] = resizeStateImages([img({ w: 20, h: 10, ox: 3, oy: 4, canResizeWidth: false })], 40, 20, 80, 40);
    expect([r.w, r.h, r.ox, r.oy]).toEqual([20, 20, 3, 4]);
  });
  it("isrelativeresize grows by the pixel delta", () => {
    const [r] = resizeStateImages([img({ w: 20, h: 10, isRelativeResize: true })], 40, 20, 50, 25);
    expect([r.w, r.h]).toEqual([30, 15]);
  });
  it("rounds the new state size half away from zero and ignores non-positive sizes", () => {
    expect(roundAway(2.5)).toBe(3);
    expect(roundAway(-2.5)).toBe(-3);
    const a = [img({})];
    expect(resizeStateImages(a, 32, 32, 0, 10)).toBe(a);
  });
});

describe("childResize (UIComponent Resize FUN_14059bb70)", () => {
  it("scales a child proportionally by default", () => {
    expect(childResize({ w: 100, h: 50 }, flags, { w: 1000, h: 500 }, { w: 2000, h: 500 })).toEqual({ w: 200, h: 50 });
  });
  it("isrelativeresize: pixel delta", () => {
    expect(childResize({ w: 100, h: 50 }, { ...flags, isRelativeResize: true }, { w: 1000, h: 500 }, { w: 2000, h: 600 })).toEqual({ w: 1100, h: 150 });
  });
  it("respects allow flags and the aspect lock", () => {
    expect(childResize({ w: 100, h: 50 }, { ...flags, allowHorizontal: false }, { w: 1000, h: 500 }, { w: 2000, h: 1000 })).toEqual({ w: 100, h: 100 });
    expect(childResize({ w: 100, h: 50 }, { ...flags, isAspectRatioLocked: true }, { w: 1000, h: 500 }, { w: 2000, h: 500 })).toEqual({ w: 200, h: 100 });
    expect(childResize({ w: 100, h: 50 }, { ...flags, isAspectRatioLocked: true, allowVertical: false }, { w: 1000, h: 500 }, { w: 2000, h: 500 })).toEqual({ w: 100, h: 50 });
  });
});

describe("redockOffset", () => {
  it("None keeps the offset; docked = cell + dock_offset", () => {
    expect(redockOffset("None", [5, 6], [1, 1], { w: 100, h: 100 }, { w: 10, h: 10 })).toEqual([5, 6]);
    expect(redockOffset("Bottom Center", [5, 6], [1, -2], { w: 100, h: 100 }, { w: 10, h: 10 })).toEqual([46, 88]);
  });
});

describe("listLayout (FUN_14061fc70 + List / HorizontalList vtables)", () => {
  const base = {
    horizontal: false, spacing: [0, 0] as [number, number], margins: [0, 0] as [number, number],
    secondaryMargins: [0, 0] as [number, number], itemsPerRow: 1, skewAngle: 0, sizeToContent: false,
    maxLength: 0, minDimensions: [0, 0] as [number, number], equalSpacingSize: 0,
  };
  const item = (w: number, h: number, d: [number, number] = [0, 0]) => ({ w, h, dockOffset: d });
  it("vanilla cheet_sheet_battle zoom_in_out: List, margins main axis, centred in the 300 state", () => {
    const r = listLayout([item(48, 84), item(235, 43)], { w: 300, h: 167 }, { ...base, spacing: [0, 10], margins: [30, 0], crossAlign: "Center", sizeToContent: true });
    expect(r.offsets).toEqual([[126, 30], [33, 124]]);
  });
  it("vanilla icon_skill_points: HorizontalList, dock offsets, centred in the 44-high state", () => {
    const r = listLayout([item(12, 19, [0, -2]), item(11, 26, [-2, -1]), item(20, 20, [-3, -4])], { w: 50, h: 44 }, { ...base, horizontal: true, crossAlign: "Center", sizeToContent: true });
    expect(r.offsets).toEqual([[0, 11], [10, 8], [20, 8]]);
  });
  it("itemsperrow wraps rows by the tallest item", () => {
    const r = listLayout([item(10, 5), item(10, 8), item(10, 5)], { w: 100, h: 100 }, { ...base, itemsPerRow: 2, spacing: [2, 3] });
    expect(r.offsets).toEqual([[0, 0], [12, 0], [0, 11]]);
  });
});
