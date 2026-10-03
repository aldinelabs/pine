import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export declare const registerBeforeCompactHook: (
  pi: ExtensionAPI,
  piVersion?: string,
) => void;

/** Registers the `vcc_recall` tool, which searches the current session file. */
export declare const registerRecallTool: (pi: ExtensionAPI) => void;
