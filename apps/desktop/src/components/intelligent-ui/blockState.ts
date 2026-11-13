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

// The message a block sends lives in shared code, so the WeChat bridge can
// send the same text when a numbered reply answers a block.
export { interactionMessage } from "@/shared/intelligentUiMessage";
