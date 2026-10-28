import { describe, expect, it } from "vitest";
import { layerTree } from "../psdComposite";

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
