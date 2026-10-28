import { describe, expect, it } from "vitest";
import { renderExcalidraw } from "../excalidraw";

describe("renderExcalidraw", () => {
  it("draws shapes, arrows and text inside the scene's bounds", async () => {
    const scene = {
      appState: { viewBackgroundColor: "#fafafa" },
      elements: [
        {
          id: "r",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          backgroundColor: "#a5d8ff",
          seed: 1,
        },
        {
          id: "a",
          type: "arrow",
          x: 100,
          y: 25,
          width: 80,
          height: 0,
          points: [
            [0, 0],
            [80, 0],
          ],
          endArrowhead: "arrow",
          seed: 2,
        },
        {
          id: "t",
          type: "text",
          x: 10,
          y: 60,
          width: 60,
          height: 20,
          text: "Hello\nthere",
          fontSize: 16,
          seed: 3,
        },
        {
          id: "gone",
          type: "ellipse",
          x: 900,
          y: 900,
          width: 10,
          height: 10,
          isDeleted: true,
        },
      ],
    };
    const svg = new DOMParser().parseFromString(
      await renderExcalidraw(JSON.stringify(scene)),
      "image/svg+xml",
    ).documentElement;
    expect(svg.getAttribute("viewBox")).toBe("-20 -20 220 120");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#fafafa");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(2);
    expect(
      Array.from(svg.querySelectorAll("tspan"), (span) => span.textContent),
    ).toEqual(["Hello", "there"]);
  });

  it("rejects empty scenes", async () => {
    await expect(renderExcalidraw('{"elements":[]}')).rejects.toThrow();
  });
});
