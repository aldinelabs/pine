import type { InjectionKey } from "vue";

/** True inside the Assistant's conversation view; see ProjectSessionView. */
export const assistantViewKey: InjectionKey<boolean> = Symbol("assistantView");
