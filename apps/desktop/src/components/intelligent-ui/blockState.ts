/**
 * Values the user set in rendered blocks, kept for the app session so a block
 * that scrolls out of the virtualized transcript and back keeps its state.
 */
const MAX_BLOCKS = 200;
const states = new Map<string, Record<string, unknown>>();

export function readBlockState(
  key: string | undefined,
): Record<string, unknown> | undefined {
  return key === undefined ? undefined : states.get(key);
}

export function writeBlockState(
  key: string | undefined,
  state: Record<string, unknown>,
): void {
  if (key === undefined) return;
  states.delete(key);
  states.set(key, state);
  if (states.size > MAX_BLOCKS) {
    states.delete(states.keys().next().value as string);
  }
}

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
