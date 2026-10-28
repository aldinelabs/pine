import { describe, expect, it } from "vitest";
import { layoutLayers, readOrcad, renderLayout } from "../eda";

const layout = {
  format: "gdsii" as const,
  structureCount: 1,
  structures: ["TOP"],
  warnings: [],
  elements: [
    {
      kind: "boundary" as const,
      structure: "TOP",
      layer: 2,
      xy: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
    {
      kind: "path" as const,
      structure: "TOP",
      layer: 5,
      width: 1,
      xy: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    },
    {
      kind: "text" as const,
      structure: "TOP",
      text: "A<B",
      xy: [{ x: 5, y: 5 }],
    },
  ],
};

describe("renderLayout", () => {
  it("draws visible layers and escapes labels", () => {
    expect(layoutLayers(layout)).toEqual([2, 5]);
    const svg = new DOMParser().parseFromString(
      renderLayout(layout, new Set([5]), { background: "#fff", text: "#000" }),
      "image/svg+xml",
    ).documentElement;
    expect(svg.querySelectorAll("polygon")).toHaveLength(1);
    expect(svg.querySelectorAll("polyline")).toHaveLength(0);
    expect(svg.querySelector("text")?.textContent).toBe("A<B");
    // Y-up layouts are flipped: the origin sits at the bottom.
    const [, y] = svg
      .querySelector("polygon")!
      .getAttribute("points")!
      .split(" ")[0]
      .split(",");
    expect(Number(y)).toBeGreaterThan(500);
  });
});

describe("readOrcad", () => {
  it("lists strings from files that are not compound documents", async () => {
    const bytes = new TextEncoder().encode(
      "\u0000\u0001RESISTOR_10K\u0000\u0002Pins=2\u0000",
    );
    const contents = await readOrcad(bytes);
    expect(contents.streams).toEqual([]);
    expect(contents.strings.join(" ")).toContain("RESISTOR_10K");
  });
});
