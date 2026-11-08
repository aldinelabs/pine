const PAIRING_LINK = /(https?:\/\/\S*?)?#pair=[A-Za-z0-9_-]+/;

/**
 * Finds the pairing link in pasted text, which may carry extra words or only
 * the `#pair=…` part. Anything else is returned trimmed so pairing reports it
 * as invalid.
 */
export function extractPairingUrl(text: string): string {
  const match = PAIRING_LINK.exec(text);
  if (!match) return text.trim();
  return match[1] ? match[0] : `https://pine.invalid/${match[0]}`;
}
