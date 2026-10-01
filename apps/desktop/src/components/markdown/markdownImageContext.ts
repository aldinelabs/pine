import type { ComputedRef, InjectionKey } from "vue";

/** Inherited by image renderers, including those nested in lists and tables. */
export const markdownImageDocumentUrl: InjectionKey<
  ComputedRef<string | undefined>
> = Symbol("markdownImageDocumentUrl");
