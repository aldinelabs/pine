import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readMindMap, renderMindMap, type MindSheet } from "../mindmap";

const palette = {
  background: "#fff",
  foreground: "#111",
  muted: "#eee",
  mutedForeground: "#777",
  border: "#ddd",
  primary: "#222",
  primaryForeground: "#fafafa",
  font: "sans-serif",
};

describe("readMindMap", () => {
  it("reads XMind 2020 sheets through JSZip", async () => {
    const zip = new JSZip();
    zip.file(
      "content.json",
      JSON.stringify([
        {
          id: "s",
          title: "Plan",
          rootTopic: {
            id: "r",
            title: "Root",
            children: { attached: [{ id: "a", title: "Child" }] },
          },
        },
      ]),
    );
    const sheets = await readMindMap(
      await zip.generateAsync({ type: "arraybuffer" }),
    );
    expect(sheets[0].title).toBe("Plan");
    expect(sheets[0].root.data.text).toBe("Root");
    expect(sheets[0].root.children?.[0]?.data.text).toBe("Child");
  });

  it("rejects archives without a map", async () => {
    const zip = new JSZip();
    zip.file("other.txt", "x");
    await expect(
      readMindMap(await zip.generateAsync({ type: "arraybuffer" })),
    ).rejects.toThrow();
  });
});

describe("renderMindMap", () => {
  const sheet: MindSheet = {
    root: {
      data: { text: "Root" },
      children: [
        { data: { text: "Right & <one>", priority: 2 } },
        { data: { text: "Left", label: ["tag"] } },
        {
          data: { text: "Folded", expandState: "collapse" },
          children: [{ data: { text: "Hidden" } }, { data: { text: "Too" } }],
        },
      ],
    },
  };

  it("splits branches to both sides and escapes text", () => {
    const svg = new DOMParser().parseFromString(
      renderMindMap(sheet, palette),
      "image/svg+xml",
    ).documentElement;
    const texts = Array.from(
      svg.querySelectorAll("text"),
      (node) => node.textContent,
    );
    expect(texts).toContain("Right & <one>");
    expect(texts).toContain("tag");
    expect(texts).not.toContain("Hidden");
    // The folded branch shows how many topics it hides.
    expect(texts).toContain("2");
    const x = (label: string) =>
      Number(
        Array.from(svg.querySelectorAll("text"))
          .find((node) => node.textContent === label)
          ?.getAttribute("x"),
      );
    const rootX = x("Root");
    expect(x("Left")).toBeLessThan(rootX);
    expect(x("Right & <one>")).toBeGreaterThan(rootX);
  });
});
