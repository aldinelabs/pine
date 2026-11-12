<script setup lang="ts">
// Pine diverges from the generated component here: the frame loop is demand
// driven (it runs only while a layer is still easing towards the pointer and
// stops once every layer has settled), it pauses while `active` is false, and
// the container rect is cached instead of read on every pointer move. A CLI
// regeneration would undo this; keep these changes when upgrading.
import type { HTMLAttributes } from "vue";
import type { ParallaxFloatContext } from "./ParallaxFloatContext";
import { cn } from "@/lib/utils";
import { onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { PARALLAX_FLOAT_KEY } from "./ParallaxFloatContext";

interface Props {
  class?: HTMLAttributes["class"];
  sensitivity?: number;
  easingFactor?: number;
  verticalResistance?: number;
  /** While false no frame runs and pointer moves are ignored. */
  active?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  sensitivity: 1,
  easingFactor: 0.05,
  verticalResistance: 1,
  active: true,
});

/** Below a hundredth of a pixel the remaining distance is invisible, so the
 * loop snaps the layers onto their targets and stops. */
const SETTLE_EPSILON_PX = 0.01;

const containerRef = ref<HTMLElement | null>(null);
const mousePosition = { x: 0, y: 0 };
const elements = new Map<
  HTMLElement,
  { depth: number; currentPosition: { x: number; y: number } }
>();

const context: ParallaxFloatContext = {
  registerElement(element, depth) {
    elements.set(element, {
      depth: depth ?? 0.01,
      currentPosition: { x: 0, y: 0 },
    });
    requestFrame();
  },
  updateElement(element, depth) {
    const data = elements.get(element);
    if (data) data.depth = depth ?? 0.01;
    requestFrame();
  },
  unregisterElement(element) {
    elements.delete(element);
  },
};

provide(PARALLAX_FLOAT_KEY, context);

let animationFrame = 0;
let mounted = false;
let containerRect: DOMRect | null = null;
let resizeObserver: ResizeObserver | null = null;

function invalidateRect() {
  containerRect = null;
}

function updateMousePosition(clientX: number, clientY: number) {
  if (!props.active) return;
  const container = containerRef.value;
  if (!container) return;

  containerRect ??= container.getBoundingClientRect();
  const rect = containerRect;
  mousePosition.x = clientX - (rect.left + rect.width / 2);
  mousePosition.y = clientY - (rect.top + rect.height / 2);
  requestFrame();
}

function handleMouseMove(event: MouseEvent) {
  updateMousePosition(event.clientX, event.clientY);
}

function handleTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (touch) updateMousePosition(touch.clientX, touch.clientY);
}

function requestFrame() {
  if (!mounted || !props.active || animationFrame !== 0) return;
  animationFrame = window.requestAnimationFrame(animate);
}

function cancelFrame() {
  if (animationFrame === 0) return;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function animate() {
  animationFrame = 0;
  const verticalResistance = Math.max(props.verticalResistance, 0);
  const easingFactor = Math.min(Math.max(props.easingFactor, 0), 1);
  let settled = true;
  elements.forEach((data, element) => {
    const strength = (data.depth * props.sensitivity) / 20;
    const targetX = mousePosition.x * strength;
    const targetY = mousePosition.y * strength * verticalResistance;
    const position = data.currentPosition;
    if (
      Math.abs(targetX - position.x) < SETTLE_EPSILON_PX &&
      Math.abs(targetY - position.y) < SETTLE_EPSILON_PX
    ) {
      // Already at rest: snap and leave the element's transform alone when
      // nothing would change.
      if (position.x === targetX && position.y === targetY) return;
      position.x = targetX;
      position.y = targetY;
    } else {
      position.x += (targetX - position.x) * easingFactor;
      position.y += (targetY - position.y) * easingFactor;
      settled = false;
    }

    element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
  });

  // An easing factor of 0 never moves, so it never needs another frame.
  if (!settled && easingFactor > 0) requestFrame();
  // The next burst of movement re-reads the rect, so layout changes that no
  // resize or scroll event announced are still picked up.
  else invalidateRect();
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      invalidateRect();
      requestFrame();
    } else {
      cancelFrame();
    }
  },
);

onMounted(() => {
  mounted = true;
  window.addEventListener("mousemove", handleMouseMove, { passive: true });
  window.addEventListener("touchmove", handleTouchMove, { passive: true });
  window.addEventListener("resize", invalidateRect, { passive: true });
  window.addEventListener("scroll", invalidateRect, {
    capture: true,
    passive: true,
  });
  if (typeof ResizeObserver !== "undefined" && containerRef.value) {
    resizeObserver = new ResizeObserver(invalidateRect);
    resizeObserver.observe(containerRef.value);
  }
  requestFrame();
});

onBeforeUnmount(() => {
  mounted = false;
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("touchmove", handleTouchMove);
  window.removeEventListener("resize", invalidateRect);
  window.removeEventListener("scroll", invalidateRect, { capture: true });
  resizeObserver?.disconnect();
  resizeObserver = null;
  cancelFrame();
  elements.clear();
});
</script>

<template>
  <div
    ref="containerRef"
    :class="cn('absolute top-0 left-0 h-full w-full', props.class)"
  >
    <slot />
  </div>
</template>
