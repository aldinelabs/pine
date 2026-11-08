import { shallowRef } from "vue";
import type { MessageKey } from "./i18n";
import type { StoredHost } from "./store";

/** Text kept untranslated, so it follows a language change. */
export interface Message {
  key: MessageKey;
  values?: Record<string, string>;
}

export interface ViewAction {
  label: MessageKey;
  run: () => void;
  /** The one action the person most likely wants. */
  primary?: boolean;
}

/** What the page shows above, or instead of, the embedded Pine. */
export type View =
  | {
      kind: "status";
      message: Message;
      /** Still working, rather than waiting for the person. */
      busy: boolean;
      actions: ViewAction[];
    }
  | {
      kind: "list";
      hosts: StoredHost[];
      pair: (url: string) => void;
      open: (host: StoredHost) => void;
      forget: (host: StoredHost) => Promise<void>;
    }
  | { kind: "pine" };

export const view = shallowRef<View>({
  kind: "status",
  message: { key: "starting" },
  busy: true,
  actions: [],
});
