/**
 * Loads 3D files into three.js objects: mesh and scene formats through
 * three's loaders, B-rep CAD (STEP, IGES, BREP) through OpenCascade in a
 * worker. Formats that need an engine Pine does not ship are reported as
 * unsupported rather than drawn wrongly.
 */
import type { GeometryKernelNode } from "@file-viewer/geometry-engine";
import * as THREE from "three";

export class UnsupportedModelError extends Error {}

export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Point clouds draw as points, which wireframe does not apply to. */
  points: boolean;
}

const surface = () =>
  new THREE.MeshStandardMaterial({
    color: 0xa3a8b0,
    metalness: 0.05,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });

const pointMaterial = (geometry: THREE.BufferGeometry) =>
  new THREE.PointsMaterial({
    size: 0,
    sizeAttenuation: false,
    vertexColors: Boolean(geometry.getAttribute("color")),
    color: geometry.getAttribute("color") ? 0xffffff : 0x6b7280,
  });

function meshOf(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const material = surface();
  if (geometry.getAttribute("color")) material.vertexColors = true;
  return new THREE.Mesh(geometry, material);
}

function pointsOf(geometry: THREE.BufferGeometry): THREE.Points {
  const material = pointMaterial(geometry);
  material.size = 2;
  return new THREE.Points(geometry, material);
}

const text = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

async function loadOcct(
  buffer: ArrayBuffer,
  type: string,
): Promise<THREE.Object3D> {
  const [{ importOcctGeometryFile }, { resolveFileViewerModelAssetUrls }] =
    await Promise.all([
      import("@file-viewer/geometry-engine"),
      import("@file-viewer/core/assets"),
    ]);
  const assets = resolveFileViewerModelAssetUrls(
    undefined,
    new URL("file-viewer/", document.baseURI).href,
  );
  const result = await importOcctGeometryFile(buffer, type, {
    ...assets,
    wasmUrl: assets.wasmUrl,
    useWorker: true,
  });
  if (!result.success || !result.meshes.length)
    throw new Error("The CAD file has no renderable geometry.");
  const meshes = result.meshes.map((source) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        Float32Array.from(source.attributes.position.array),
        3,
      ),
    );
    geometry.setIndex(Array.from(source.index.array));
    const normals = source.attributes.normal?.array;
    if (normals && normals.length === source.attributes.position.array.length)
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(Float32Array.from(normals), 3),
      );
    else geometry.computeVertexNormals();
    const material = surface();
    const [r, g, b] = source.color ?? [];
    if (r !== undefined && g !== undefined && b !== undefined)
      material.color.setRGB(r, g, b);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = source.name ?? "";
    return mesh;
  });
  const used = new Set<number>();
  const build = (node: GeometryKernelNode): THREE.Group => {
    const group = new THREE.Group();
    group.name = node.name ?? "";
    for (const index of node.meshes) {
      const mesh = meshes[index];
      if (!mesh) continue;
      used.add(index);
      // A mesh placed twice is instanced by cloning it.
      group.add(mesh.parent ? mesh.clone() : mesh);
    }
    for (const child of node.children) group.add(build(child));
    return group;
  };
  const root = result.root ? build(result.root) : new THREE.Group();
  meshes.forEach((mesh, index) => {
    if (!used.has(index)) root.add(mesh);
  });
  // CAD files are Z-up; three is Y-up.
  root.rotation.x = -Math.PI / 2;
  return root;
}

export async function loadModel(
  buffer: ArrayBuffer,
  extension: string,
): Promise<LoadedModel> {
  const done = (
    object: THREE.Object3D,
    animations: THREE.AnimationClip[] = [],
  ) => ({
    object,
    animations,
    points: object instanceof THREE.Points,
  });
  switch (extension) {
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().parseAsync(
        extension === "gltf" ? text(buffer) : buffer,
        "",
      );
      return done(gltf.scene, gltf.animations);
    }
    case "obj": {
      const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
      return done(new OBJLoader().parse(text(buffer)));
    }
    case "stl": {
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      return done(meshOf(new STLLoader().parse(buffer)));
    }
    case "ply": {
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      const geometry = new PLYLoader().parse(buffer);
      return done(geometry.index ? meshOf(geometry) : pointsOf(geometry));
    }
    case "fbx": {
      const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
      const object = new FBXLoader().parse(buffer, "");
      return done(object, object.animations);
    }
    case "dae": {
      const { ColladaLoader } =
        await import("three/addons/loaders/ColladaLoader.js");
      const result = new ColladaLoader().parse(text(buffer), "");
      if (!result) throw new Error("The Collada file has no scene.");
      return done(result.scene);
    }
    case "3ds": {
      const { TDSLoader } = await import("three/addons/loaders/TDSLoader.js");
      return done(new TDSLoader().parse(buffer, ""));
    }
    case "3mf": {
      const { ThreeMFLoader } =
        await import("three/addons/loaders/3MFLoader.js");
      return done(new ThreeMFLoader().parse(buffer));
    }
    case "amf": {
      const { AMFLoader } = await import("three/addons/loaders/AMFLoader.js");
      return done(new AMFLoader().parse(buffer));
    }
    case "usd":
    case "usda":
    case "usdc":
    case "usdz": {
      const { USDLoader } = await import("three/addons/loaders/USDLoader.js");
      return done(new USDLoader().parse(buffer));
    }
    case "pcd": {
      const { PCDLoader } = await import("three/addons/loaders/PCDLoader.js");
      // The loader sizes points in world units; draw them a few pixels wide.
      return done(pointsOf(new PCDLoader().parse(buffer).geometry));
    }
    case "wrl":
    case "vrml": {
      const { VRMLLoader } = await import("three/addons/loaders/VRMLLoader.js");
      return done(new VRMLLoader().parse(text(buffer), ""));
    }
    case "xyz": {
      const { XYZLoader } = await import("three/addons/loaders/XYZLoader.js");
      // The typings take a callback; three returns the geometry instead.
      const loader = new XYZLoader() as unknown as {
        parse(data: string): THREE.BufferGeometry;
      };
      const geometry = loader.parse(text(buffer));
      return done(pointsOf(geometry));
    }
    case "vtk":
    case "vtp": {
      const { VTKLoader } = await import("three/addons/loaders/VTKLoader.js");
      return done(meshOf(new VTKLoader().parse(buffer, "")));
    }
    case "step":
    case "stp":
    case "iges":
    case "igs":
    case "brep":
      return done(await loadOcct(buffer, extension));
    default:
      throw new UnsupportedModelError(`No 3D reader for .${extension}.`);
  }
}
