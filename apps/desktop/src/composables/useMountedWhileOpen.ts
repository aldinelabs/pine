import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";

/**
 * Whether a collapsible region's content should be mounted: while it is open,
 * and for `closeDelayMs` after it closes so the collapse animation still has
 * content to fold. Collapsed transcript panels otherwise kept every thinking
 * block and tool run rendered at zero height for the whole session.
 */
export function useMountedWhileOpen(
  open: Ref<boolean>,
  closeDelayMs: number,
): ComputedRef<boolean> {
  const closing = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(open, (isOpen, wasOpen) => {
    clearTimeout(timer);
    closing.value = !isOpen && wasOpen;
    if (closing.value)
      timer = setTimeout(() => {
        closing.value = false;
      }, closeDelayMs);
  });
  onScopeDispose(() => clearTimeout(timer));
  return computed(() => open.value || closing.value);
}
