import path from "node:path";
import type {
  ExtensionAPI,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { registerBeforeCompactHook } from "./pi-vcc.js";

const PI_VCC_CONFIG_FILE = "pi-vcc-config.json";
const RECALL_NOTE_SEPARATOR = "\n\n---\n\nUse `vcc_recall`";

/**
 * pi-vcc's algorithmic compaction, active only while the semantic route is
 * selected. Only its compaction hook is registered: Pine does not expose the
 * `vcc_recall` tool or the `/pi-vcc` commands, and skips its settings scaffold.
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
        ? async (...args: unknown[]) =>
            isEnabled() ? withoutRecallNote(await handler(...args)) : undefined
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

/** Pine does not expose `vcc_recall`, so drop the summary footer that names it. */
function withoutRecallNote(result: unknown): unknown {
  const compaction = (result as { compaction?: { summary?: unknown } })
    ?.compaction;
  if (typeof compaction?.summary !== "string") return result;
  const index = compaction.summary.lastIndexOf(RECALL_NOTE_SEPARATOR);
  if (index < 0) return result;
  return {
    ...(result as object),
    compaction: { ...compaction, summary: compaction.summary.slice(0, index) },
  };
}
