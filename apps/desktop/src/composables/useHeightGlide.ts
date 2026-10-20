import { onBeforeUnmount, onMounted, type ShallowRef } from "vue";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";

/**
 * Glides `box` to the height of `content` whenever the content resizes, so
 * rows added to or removed from a card grow or shrink it rather than
 * snapping. A resize mid-glide carries on from the height on screen.
 */
export function useHeightGlide(
  box: Readonly<ShallowRef<HTMLElement | null>>,
  content: Readonly<ShallowRef<HTMLElement | null>>,
): void {
  let observer: ResizeObserver | null = null;
  let last: number | null = null;
  /** Only its own glide; the element may run other animations too. */
  let gliding: Animation | null = null;

  function glide(): void {
    const element = box.value;
    const inner = content.value;
    if (!element || !inner) return;
    const next = inner.offsetHeight;
    const previous = last;
    last = next;
    if (previous === null || previous === next) return;
    if (typeof element.animate !== "function") return;
    // Layout height, unaffected by the transforms of an enclosing reveal.
    const from = gliding ? element.offsetHeight : previous;
    gliding?.cancel();
    // Clips the rows still sliding in or out.
    element.style.overflow = "hidden";
    const animation = element.animate(
      [{ height: `${from}px` }, { height: `${next}px` }],
      { duration: DURATION_MS, easing: EASE_OUT_EXPO },
    );
    gliding = animation;
    animation.addEventListener(
      "finish",
      () => {
        gliding = null;
        element.style.overflow = "";
      },
      { once: true },
    );
  }

  onMounted(() => {
    if (typeof ResizeObserver === "undefined" || !content.value) return;
    // ResizeObserver runs before paint, so the old height is what shows.
    observer = new ResizeObserver(glide);
    observer.observe(content.value);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });
}
