import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export declare const registerBeforeCompactHook: (
  pi: ExtensionAPI,
  piVersion?: string,
) => void;

/**
 * Registers pi-vcc's session history search, which only reads the current
 * session file. Its name is RECALL_TOOL_NAME once vite.agent.config.ts has
 * rewritten pi-vcc's `vcc_recall`.
 */
export declare const registerRecallTool: (pi: ExtensionAPI) => void;
