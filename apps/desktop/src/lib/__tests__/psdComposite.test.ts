import { describe, expect, it } from "vitest";
import type { Psd } from "ag-psd";
import { hasRealComposite, layerTree } from "../psdComposite";

describe("layerTree", () => {
  it("lists layers top to bottom with their depth", () => {
    const tree = layerTree([
      { name: "Background" },
      {
        name: "Group",
        children: [{ name: "Inner low" }, { name: "Inner high" }],
      },
      { name: "Top" },
    ]);
    expect(
      tree.map((node) => [node.name, node.depth, node.group, node.id]),
    ).toEqual([
      ["Top", 0, false, "2"],
      ["Group", 0, true, "1"],
      ["Inner high", 1, false, "1.1"],
      ["Inner low", 1, false, "1.0"],
      ["Background", 0, false, "0"],
    ]);
  });
});

describe("hasRealComposite", () => {
  const composite = {} as HTMLCanvasElement;
  const layered = (versionInfo?: { hasRealMergedData: boolean }) =>
    ({
      width: 1,
      height: 1,
      canvas: composite,
      children: [{ name: "Layer" }],
      imageResources: versionInfo
        ? {
            versionInfo: {
              ...versionInfo,
              readerName: "",
              writerName: "",
              fileVersion: 1,
            },
          }
        : {},
    }) as Psd;

  it("trusts a layered file's composite only when Photoshop vouches for it", () => {
    expect(hasRealComposite(layered({ hasRealMergedData: true }))).toBe(true);
    // Saved without "maximize compatibility": a placeholder.
    expect(hasRealComposite(layered({ hasRealMergedData: false }))).toBe(false);
    // Other writers may store a placeholder without saying so.
    expect(hasRealComposite(layered())).toBe(false);
  });

  it("uses the composite of a flat file, which has nothing else", () => {
    expect(hasRealComposite({ width: 1, height: 1, canvas: composite })).toBe(
      true,
    );
    expect(hasRealComposite({ width: 1, height: 1 })).toBe(false);
  });
});
