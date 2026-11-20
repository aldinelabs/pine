import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHomePath } from "../homePath";

describe("expandHomePath", () => {
  it("expands a leading tilde and leaves other paths alone", () => {
    const home = path.join(path.sep, "Users", "ada");
    expect(expandHomePath("~/课程 资料/a.png", home)).toBe(
      path.join(home, "课程 资料", "a.png"),
    );
    expect(expandHomePath("~", home)).toBe(home);
    expect(expandHomePath("/tmp/~/a.png", home)).toBe("/tmp/~/a.png");
    expect(expandHomePath("~other/a.png", home)).toBe("~other/a.png");
  });
});
