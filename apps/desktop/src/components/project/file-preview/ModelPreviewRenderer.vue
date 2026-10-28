<script setup lang="ts">
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { Axis3d, Box, Grid3x3, Rotate3d, Scan } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { resolveColors } from "@/lib/themeColors";
import { previewExtension } from "@/shared/previewFormats";
import { useAppearanceStore } from "@/stores/appearance";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t, locale } = useI18n();
const appearance = useAppearanceStore();
const toolbar = usePreviewToolbar(() => props.compact);
const host = useTemplateRef<HTMLDivElement>("host");

const loading = ref(true);
const unsupported = ref(false);
const options = ref<string[]>(["grid"]);
const stats = ref<{ meshes: number; triangles: number; points: number }>();
const reading = new AbortController();

const summary = computed(() => {
  const value = stats.value;
  if (!value) return "";
  return value.points && !value.meshes
    ? t("project.preview.modelPoints", {
        points: value.points.toLocaleString(locale.value),
      })
    : t("project.preview.modelStats", {
        meshes: value.meshes.toLocaleString(locale.value),
        triangles: value.triangles.toLocaleString(locale.value),
      });
});

let three: typeof THREE | undefined;
let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let controls: OrbitControls | undefined;
let model: THREE.Object3D | undefined;
let grid: THREE.GridHelper | undefined;
let axes: THREE.AxesHelper | undefined;
let mixer: THREE.AnimationMixer | undefined;
let clock: THREE.Clock | undefined;
let frame: number | undefined;
let resizeObserver: ResizeObserver | undefined;
/** Camera distance that fits the model; the zoom slider is relative to it. */
let fitDistance = 1;
let modelRadius = 1;
let applyingZoom = false;

function draw(): void {
  if (!renderer || !scene || !camera) return;
  const delta = clock?.getDelta() ?? 0;
  mixer?.update(delta);
  controls?.update(delta);
  renderer.render(scene, camera);
}

function loop(): void {
  draw();
  frame = props.active ? requestAnimationFrame(loop) : undefined;
}

function fit(): void {
  if (!three || !camera || !controls || !model) return;
  const box = new three.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new three.Sphere());
  modelRadius = Math.max(sphere.radius, 1e-6);
  const fov = (camera.fov * Math.PI) / 180;
  fitDistance = (modelRadius / Math.sin(fov / 2)) * 1.1;
  const direction = new three.Vector3(1, 0.8, 1.2).normalize();
  camera.position.copy(sphere.center).addScaledVector(direction, fitDistance);
  camera.near = fitDistance / 1000;
  camera.far = fitDistance * 1000;
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.update();
  emit("zoomChange", 100);
}

function setZoom(percent: number): void {
  if (!camera || !controls) return;
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(fitDistance / (percent / 100));
  applyingZoom = true;
  camera.position.copy(controls.target).add(offset);
  controls.update();
  applyingZoom = false;
}

function themeHelpers(): void {
  if (!three || !scene) return;
  const colors = resolveColors({ line: "--muted-foreground" });
  grid?.removeFromParent();
  grid?.dispose();
  const size = modelRadius * 4;
  grid = new three.GridHelper(size, 20, colors.line, colors.line);
  const material = grid.material as THREE.Material;
  material.transparent = true;
  material.opacity = 0.3;
  if (model) {
    const box = new three.Box3().setFromObject(model);
    grid.position.y = box.min.y;
    grid.position.x = (box.min.x + box.max.x) / 2;
    grid.position.z = (box.min.z + box.max.z) / 2;
  }
  grid.visible = options.value.includes("grid");
  scene.add(grid);
}

function applyOptions(): void {
  if (grid) grid.visible = options.value.includes("grid");
  if (axes) axes.visible = options.value.includes("axes");
  if (controls) controls.autoRotate = options.value.includes("rotate");
  const wireframe = options.value.includes("wireframe");
  model?.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of [mesh.material].flat())
      if ("wireframe" in material)
        (material as THREE.MeshStandardMaterial).wireframe = wireframe;
  });
}

async function setup(): Promise<void> {
  const element = host.value;
  if (!element) return;
  const [
    THREE_,
    { OrbitControls: Controls },
    { loadModel, UnsupportedModelError },
  ] = await Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
    import("@/lib/modelLoading"),
  ]);
  three = THREE_;
  let loaded;
  try {
    loaded = await loadModel(
      await readPreviewBytes(props.preview, reading.signal),
      previewExtension(props.filePath),
    );
  } catch (error) {
    if (error instanceof UnsupportedModelError) {
      unsupported.value = true;
      return;
    }
    throw error;
  }
  if (reading.signal.aborted) return;
  renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(element.clientWidth, element.clientHeight);
  renderer.outputColorSpace = three.SRGBColorSpace;
  element.append(renderer.domElement);
  scene = new three.Scene();
  camera = new three.PerspectiveCamera(
    40,
    element.clientWidth / Math.max(1, element.clientHeight),
  );
  scene.add(new three.HemisphereLight(0xffffff, 0x6b6b6b, 1.4));
  const light = new three.DirectionalLight(0xffffff, 1.3);
  camera.add(light);
  light.position.set(1, 2, 3);
  scene.add(camera);
  controls = new Controls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1.5;
  controls.addEventListener("change", () => {
    if (applyingZoom || !camera || !controls) return;
    const distance = camera.position.distanceTo(controls.target);
    emit("zoomChange", Math.round((fitDistance / distance) * 100));
  });
  model = loaded.object;
  scene.add(model);
  if (loaded.animations.length) {
    mixer = new three.AnimationMixer(model);
    for (const clip of loaded.animations) mixer.clipAction(clip).play();
  }
  clock = new three.Clock();
  let meshes = 0;
  let triangles = 0;
  let points = 0;
  model.traverse((child) => {
    const object = child as THREE.Mesh | THREE.Points;
    const position = object.geometry?.getAttribute("position");
    if ((object as THREE.Points).isPoints) points += position?.count ?? 0;
    if (!(object as THREE.Mesh).isMesh) return;
    meshes++;
    triangles += (object.geometry.index?.count ?? position?.count ?? 0) / 3;
  });
  stats.value = { meshes, triangles: Math.round(triangles), points };
  fit();
  axes = new three.AxesHelper(modelRadius * 1.2);
  scene.add(axes);
  themeHelpers();
  applyOptions();
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera || !element.clientWidth) return;
    renderer.setSize(element.clientWidth, element.clientHeight);
    camera.aspect = element.clientWidth / Math.max(1, element.clientHeight);
    camera.updateProjectionMatrix();
    draw();
  });
  resizeObserver.observe(element);
  loop();
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    gestureZoom: true,
    zoomMin: 10,
    zoomMax: 1000,
    toolbar: !props.compact,
  });
  try {
    await setup();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to load the 3D model.", error);
    emit("failed");
  } finally {
    loading.value = false;
  }
});

watch(options, applyOptions, { deep: true });
watch(
  () => props.zoom,
  (value) => {
    if (!camera || !controls || props.compact) return;
    const current = Math.round(
      (fitDistance / camera.position.distanceTo(controls.target)) * 100,
    );
    if (current !== value) setZoom(value);
  },
);
watch(
  () => props.active,
  (active) => {
    if (active && frame === undefined && renderer) loop();
  },
);
watch(
  () => appearance.colorScheme,
  () => requestAnimationFrame(themeHelpers),
);

onBeforeUnmount(() => {
  reading.abort();
  if (frame !== undefined) cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  controls?.dispose();
  model?.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of [mesh.material].flat()) material.dispose();
  });
  renderer?.dispose();
  renderer?.forceContextLoss();
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && stats" :to="toolbar">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.modelFit')"
        :title="t('project.preview.modelFit')"
        @click="fit"
      >
        <Scan />
      </Button>
      <ToggleGroup
        v-model="options"
        type="multiple"
        size="sm"
        :aria-label="t('project.preview.modelDisplay')"
      >
        <ToggleGroupItem
          value="wireframe"
          :aria-label="t('project.preview.modelWireframe')"
          :title="t('project.preview.modelWireframe')"
          ><Box
        /></ToggleGroupItem>
        <ToggleGroupItem
          value="grid"
          :aria-label="t('project.preview.modelGrid')"
          :title="t('project.preview.modelGrid')"
          ><Grid3x3
        /></ToggleGroupItem>
        <ToggleGroupItem
          value="axes"
          :aria-label="t('project.preview.modelAxes')"
          :title="t('project.preview.modelAxes')"
          ><Axis3d
        /></ToggleGroupItem>
        <ToggleGroupItem
          value="rotate"
          :aria-label="t('project.preview.modelRotate')"
          :title="t('project.preview.modelRotate')"
          ><Rotate3d
        /></ToggleGroupItem>
      </ToggleGroup>
      <span class="truncate text-sm text-muted-foreground">{{ summary }}</span>
    </Teleport>
    <Empty v-if="unsupported" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Box /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.unsupportedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t("project.preview.modelUnsupported")
        }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <div
      v-else
      ref="host"
      data-slot="model-preview"
      class="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
    />
    <div
      v-if="loading"
      class="absolute inset-0 grid place-items-center bg-background"
      role="status"
    >
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
