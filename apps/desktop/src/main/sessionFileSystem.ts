import {
  BACKGROUND_CONTEXT,
  type Context,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

// The published pi-agent-core 0.87.1 legacy reader accepts these v3 types.
// pi-coding-agent also writes context_edit, and may add more metadata types.
const LEGACY_READER_TYPES = new Set([
  "message",
  "custom",
  "custom_message",
  "branch_summary",
  "compaction",
  "model_change",
  "thinking_level_change",
  "active_tools_change",
  "session_info",
  "label",
]);

function parseRecord(text: string): Record<string, unknown> | undefined {
  try {
    const record: unknown = JSON.parse(text);
    return typeof record === "object" &&
      record !== null &&
      !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function isLegacyHeader(record: Record<string, unknown> | undefined): boolean {
  return record?.type === "session" && record.version === 3;
}

/**
 * Heal v3 compatibility on read, leaving the authoritative agent file intact.
 * Unsupported entries become opaque custom metadata with their identities and
 * payloads preserved. History shows the original messages; the coding agent
 * still reads the original context_edit records and applies their projections.
 */
export class PineSessionFileSystem extends NodeExecutionEnv {
  async isLegacyV3Session(sessionFile: string): Promise<boolean> {
    const result = await this.readTextLines(
      sessionFile,
      { maxLines: 1 },
      BACKGROUND_CONTEXT,
    );
    if (!result.ok) throw result.error;
    return isLegacyHeader(parseRecord(result.value[0] ?? ""));
  }

  override async openTextLineReader(
    sessionFile: string,
    context: Context,
  ): ReturnType<NodeExecutionEnv["openTextLineReader"]> {
    const result = await super.openTextLineReader(sessionFile, context);
    if (!result.ok) return result;
    const reader = result.value;
    let firstLine = true;
    let legacy = false;

    return {
      ok: true,
      value: {
        close: (readContext) => reader.close(readContext),
        readLine: async (readContext) => {
          const line = await reader.readLine(readContext);
          if (!line.ok || line.value === undefined) return line;
          if (firstLine) {
            firstLine = false;
            legacy = isLegacyHeader(parseRecord(line.value.text));
            return line;
          }
          if (!legacy || !line.value.terminated) return line;

          const record = parseRecord(line.value.text);
          if (
            !record ||
            typeof record.type !== "string" ||
            record.type.length === 0 ||
            record.type === "session" ||
            LEGACY_READER_TYPES.has(record.type) ||
            typeof record.id !== "string" ||
            record.id.length === 0 ||
            (record.parentId !== null && typeof record.parentId !== "string") ||
            typeof record.timestamp !== "string" ||
            !Number.isFinite(Date.parse(record.timestamp))
          ) {
            // Let upstream validation report malformed records and references.
            return line;
          }

          return {
            ok: true,
            value: {
              ...line.value,
              text: JSON.stringify({
                type: "custom",
                id: record.id,
                parentId: record.parentId,
                timestamp: record.timestamp,
                customType: `pine.legacy.v3.${record.type}`,
                data: record,
              }),
            },
          };
        },
      },
    };
  }
}
