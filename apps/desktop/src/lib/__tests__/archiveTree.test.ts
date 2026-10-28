import { describe, expect, it } from "vitest";
import { archiveTree, visibleArchiveRows } from "../archiveTree";

const entries = [
  { path: "src/b.ts", size: 2 },
  { path: "src/a/deep.txt", size: 3 },
  { path: "README.md", size: 1 },
  { path: "src/file10.ts", size: 4 },
  { path: "src/file9.ts", size: 5 },
];

describe("archiveTree", () => {
  it("nests files under folders, folders first and in natural order", () => {
    const tree = archiveTree(entries);
    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    expect(tree[0].children.map((node) => node.name)).toEqual([
      "a",
      "b.ts",
      "file9.ts",
      "file10.ts",
    ]);
  });

  it("lists expanded folders and filter matches", () => {
    const tree = archiveTree(entries);
    expect(
      visibleArchiveRows(tree, new Set(), "").map((row) => row.path),
    ).toEqual(["src", "README.md"]);
    expect(
      visibleArchiveRows(tree, new Set(["src"]), "").map((row) => [
        row.path,
        row.depth,
      ]),
    ).toEqual([
      ["src", 0],
      ["src/a", 1],
      ["src/b.ts", 1],
      ["src/file9.ts", 1],
      ["src/file10.ts", 1],
      ["README.md", 0],
    ]);
    expect(
      visibleArchiveRows(tree, new Set(), "DEEP").map((row) => row.path),
    ).toEqual(["src", "src/a", "src/a/deep.txt"]);
  });
});
