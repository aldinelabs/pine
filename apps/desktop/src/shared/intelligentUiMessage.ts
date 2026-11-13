/**
 * The text an interface block sends to the assistant. Framework-free, so the
 * renderer (a click) and the WeChat bridge (a numbered reply) send the same
 * message for the same choice.
 */

function formatValue(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return formatValue(value.value);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * The message a @ToAssistant step sends: its own text, then the block's
 * current values so the agent sees what the user chose.
 */
export function interactionMessage(
  message: string,
  state: Record<string, unknown>,
): string {
  const text = message.trim();
  const values = Object.entries(state).flatMap(([name, value]) => {
    const formatted = formatValue(value);
    return formatted === undefined
      ? []
      : [`${name.replace(/^\$/u, "")}: ${formatted}`];
  });
  if (!text || values.length === 0) return text;
  return `${text}\n\n(${values.join("; ")})`;
}
