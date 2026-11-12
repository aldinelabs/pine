import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadingTextures, textureLoading } from "../modelTextures";

describe("loadingTextures", () => {
  it("lists material textures whose image has not arrived", () => {
    const pending = new THREE.Texture();
    const ready = new THREE.Texture({ width: 1, height: 1 });
    const material = new THREE.MeshStandardMaterial({
      map: pending,
      normalMap: ready,
    });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    group.add(
      new THREE.Mesh(new THREE.BufferGeometry(), [
        new THREE.MeshBasicMaterial({ map: pending }),
      ]),
    );

    expect(loadingTextures(group)).toEqual([pending]);

    pending.image = { width: 1, height: 1 };
    expect(loadingTextures(group)).toEqual([]);
  });

  it("treats an image element that is still decoding as loading", () => {
    const image = document.createElement("img");
    Object.defineProperty(image, "complete", {
      configurable: true,
      get: () => false,
    });
    const texture = new THREE.Texture(image);
    expect(textureLoading(texture)).toBe(true);

    Object.defineProperty(image, "complete", { get: () => true });
    expect(textureLoading(texture)).toBe(false);
  });

  it("finds nothing on an untextured model", () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    expect(loadingTextures(mesh)).toEqual([]);
  });
});
