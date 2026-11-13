import { readonly, ref, type Ref } from "vue";

const visible = ref(true);
let listening = false;

function readVisibility(): boolean {
  return document.visibilityState === "visible";
}

/**
 * Whether the window's document is shown: false while the window is hidden
 * or minimised (or, in the web client, while the browser tab or app is in the
 * background). Every caller shares one ref driven by a single
 * `visibilitychange` listener; it is always true where there is no document.
 */
export function useDocumentVisible(): Readonly<Ref<boolean>> {
  if (!listening && typeof document !== "undefined") {
    listening = true;
    visible.value = readVisibility();
    document.addEventListener("visibilitychange", () => {
      visible.value = readVisibility();
    });
  }
  return readonly(visible);
}
