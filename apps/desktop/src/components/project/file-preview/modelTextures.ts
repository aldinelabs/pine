import type * as THREE from "three";

/**
 * Whether a texture still waits for its image. FBX, 3MF and USDZ loaders
 * return textures whose image arrives after the model has been added, so an
 * on-demand renderer has to keep drawing until it does.
 */
export function textureLoading(texture: THREE.Texture): boolean {
  const image = texture.image;
  if (image === null || image === undefined) return true;
  return (
    typeof HTMLImageElement !== "undefined" &&
    image instanceof HTMLImageElement &&
    !image.complete
  );
}

/** Textures on the model's materials whose image has not arrived yet. */
export function loadingTextures(model: THREE.Object3D): THREE.Texture[] {
  const found = new Set<THREE.Texture>();
  model.traverse((child) => {
    const material = (child as THREE.Mesh).material as
      THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const entry of [material].flat())
      for (const value of Object.values(entry))
        if ((value as THREE.Texture | null)?.isTexture) found.add(value);
  });
  return [...found].filter(textureLoading);
}
