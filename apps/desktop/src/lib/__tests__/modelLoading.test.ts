import { describe, expect, it } from "vitest";
import { loadModel, UnsupportedModelError } from "../modelLoading";

const encode = (text: string) => new TextEncoder().encode(text).buffer;

describe("loadModel", () => {
  it("loads meshes with a surface material", async () => {
    const stl = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const { object, points } = await loadModel(encode(stl), "stl");
    expect(points).toBe(false);
    expect(object.type).toBe("Mesh");
  });

  it("loads point clouds as points", async () => {
    const { object, points } = await loadModel(
      encode("0 0 0\n1 1 1\n2 2 2\n"),
      "xyz",
    );
    expect(points).toBe(true);
    expect(object.type).toBe("Points");
  });

  it("reports formats it cannot draw", async () => {
    await expect(loadModel(new ArrayBuffer(4), "ifc")).rejects.toBeInstanceOf(
      UnsupportedModelError,
    );
  });
});
