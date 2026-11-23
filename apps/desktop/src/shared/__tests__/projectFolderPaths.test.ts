import { describe, expect, it } from "vitest";
import {
  projectFolderContains,
  projectFoldersOverlap,
} from "../projectFolderPaths";

describe("projectFolderContains", () => {
  it("treats a folder and its subfolders as contained", () => {
    expect(projectFolderContains("/Users/kw/A", "/Users/kw/A")).toBe(true);
    expect(projectFolderContains("/Users/kw/A", "/Users/kw/A/B")).toBe(true);
    expect(projectFolderContains("/Users/kw/A/", "/Users/kw/A/B/")).toBe(true);
    expect(projectFolderContains("/", "/Users")).toBe(true);
  });

  it("does not match siblings that share a name prefix", () => {
    expect(projectFolderContains("/Users/kw/A", "/Users/kw/AB")).toBe(false);
    expect(projectFolderContains("/Users/kw/A/B", "/Users/kw/A")).toBe(false);
  });

  it("compares Windows paths without regard to separators or case", () => {
    expect(projectFolderContains("C:\\Work", "c:/work/Sub")).toBe(true);
    expect(projectFolderContains("C:\\", "C:\\Work")).toBe(true);
    expect(projectFolderContains("C:\\Work", "C:\\Workshop")).toBe(false);
  });
});

describe("projectFoldersOverlap", () => {
  it("is true in either nesting direction and for the same folder", () => {
    expect(projectFoldersOverlap("/A", "/A/B")).toBe(true);
    expect(projectFoldersOverlap("/A/B", "/A")).toBe(true);
    expect(projectFoldersOverlap("/A", "/A")).toBe(true);
    expect(projectFoldersOverlap("/A", "/C")).toBe(false);
  });
});
