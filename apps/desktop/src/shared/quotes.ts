/**
 * Passages the user quoted from the conversation into a message. They travel
 * in the message text, after any attachment block and before the prompt, so
 * the model reads them and the transcript can show them as quote cards.
 */
export interface PineQuote {
  /** The quoted passage, as the user selected it. */
  text: string;
  /** Who wrote the quoted message. */
  role?: "assistant" | "user";
  /** Absolute path of the project file a preview comment is about. */
  file?: string;
  /** Source lines of the passage, "12" or "12-18". */
  lines?: string;
  /** The user's comment on the passage. */
  comment?: string;
  /** The file changed and the passage was no longer in it when sent. */
  stale?: true;
}

export interface ParsedQuoteMessage {
  quotes: PineQuote[];
  prompt: string;
}

/** Longest passage one quote keeps, in characters. */
export const MAX_QUOTE_LENGTH = 8_000;

const QUOTE_BLOCK_START = '<pine_quotes version="1">';
const QUOTE_BLOCK_END = "</pine_quotes>";

function isOptionalText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isQuote(value: unknown): value is PineQuote {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const quote = value as Record<string, unknown>;
  return (
    typeof quote.text === "string" &&
    quote.text.length > 0 &&
    (quote.role === undefined ||
      quote.role === "assistant" ||
      quote.role === "user") &&
    isOptionalText(quote.file) &&
    isOptionalText(quote.lines) &&
    isOptionalText(quote.comment) &&
    (quote.stale === undefined || quote.stale === true)
  );
}

/**
 * Where a preview comment points, as "<file name>:<lines>", leaving out
 * whichever part is missing; empty for a plain quote.
 */
export function quoteSourceLabel(quote: PineQuote): string {
  const name = quote.file
    ? (quote.file.split(/[\\/]/).filter(Boolean).at(-1) ?? quote.file)
    : "";
  return [name, quote.lines ?? ""].filter(Boolean).join(":");
}

/** Whether two quotes stage the same passage and comment. */
export function isSameQuote(a: PineQuote, b: PineQuote): boolean {
  return a.text === b.text && a.file === b.file && a.comment === b.comment;
}

/** Trims a selection into a quote, or undefined when nothing is left. */
export function normalizeQuoteText(text: string): string | undefined {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_QUOTE_LENGTH
    ? `${normalized.slice(0, MAX_QUOTE_LENGTH)}…`
    : normalized;
}

export function serializeQuoteMessage(
  quotes: readonly PineQuote[],
  prompt: string,
): string {
  const normalizedPrompt = prompt.trim();
  if (quotes.length === 0) return normalizedPrompt;
  const block = [
    QUOTE_BLOCK_START,
    JSON.stringify({ quotes }),
    QUOTE_BLOCK_END,
  ].join("\n");
  return normalizedPrompt ? `${block}\n\n${normalizedPrompt}` : block;
}

export function parseQuoteMessage(message: string): ParsedQuoteMessage {
  if (!message.startsWith(`${QUOTE_BLOCK_START}\n`))
    return { quotes: [], prompt: message };
  const blockEnd = message.indexOf(`\n${QUOTE_BLOCK_END}`);
  if (blockEnd < 0) return { quotes: [], prompt: message };
  try {
    const payload = JSON.parse(
      message.slice(QUOTE_BLOCK_START.length + 1, blockEnd),
    ) as unknown;
    const quotes =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).quotes
        : undefined;
    if (!Array.isArray(quotes) || !quotes.every(isQuote))
      return { quotes: [], prompt: message };
    const prompt = message
      .slice(blockEnd + QUOTE_BLOCK_END.length + 1)
      .replace(/^\r?\n\r?\n/, "");
    return { quotes, prompt };
  } catch {
    return { quotes: [], prompt: message };
  }
}
