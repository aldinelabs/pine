import path from "node:path";
import type {
  ExtensionAPI,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { registerBeforeCompactHook, registerRecallTool } from "./pi-vcc.js";

const PI_VCC_CONFIG_FILE = "pi-vcc-config.json";

/**
 * pi-vcc's algorithmic compaction and its `vcc_recall` tool. Compaction only
 * runs while the semantic route is selected; the runtime activates the tool
 * on the same condition. Pine skips pi-vcc's `/pi-vcc` commands and settings
 * scaffold.
 */
export function createSemanticCompactionExtension(options: {
  agentDir: string;
  isEnabled: () => boolean;
}): InlineExtension {
  return {
    name: "pi-vcc",
    factory: (pi) => {
      // Keep a standalone Pi install's ~/.pi/agent/pi-vcc-config.json from
      // changing Pine's behavior; a missing file resolves to pi-vcc defaults.
      process.env.PI_VCC_CONFIG_PATH ??= path.join(
        options.agentDir,
        PI_VCC_CONFIG_FILE,
      );
      registerBeforeCompactHook(gateBeforeCompact(pi, options.isEnabled));
      registerRecallTool(pi);
    },
  };
}

function gateBeforeCompact(
  pi: ExtensionAPI,
  isEnabled: () => boolean,
): ExtensionAPI {
  const on = ((event: string, handler: (...args: unknown[]) => unknown) =>
    (pi.on as (event: string, handler: unknown) => void)(
      event,
      event === "session_before_compact"
        ? (...args: unknown[]) => (isEnabled() ? handler(...args) : undefined)
        : handler,
    )) as ExtensionAPI["on"];
  return new Proxy(pi, {
    get: (target, property) => {
      if (property === "on") return on;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
