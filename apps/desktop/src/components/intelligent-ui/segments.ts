import { INTELLIGENT_UI_FENCE_LANGUAGE } from "@/shared/intelligentUi";

export type TranscriptTextSegment =
  | { kind: "markdown"; text: string }
  | { kind: "interface"; code: string; closed: boolean };

/** CommonMark fence line: up to three spaces, then ``` or ~~~ and an info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/**
 * Split reply text at top-level `openui` fences, so blocks render beside the
 * markdown rather than inside it, where the markdown renderer's own element
 * styles would override Pine's components. Fences of any other language,
 * including ones that quote an `openui` fence, stay in the markdown.
 */
export function splitTranscriptText(text: string): TranscriptTextSegment[] {
  const segments: TranscriptTextSegment[] = [];
  let markdown: string[] = [];
  let fence: { marker: string; isInterface: boolean; body: string[] } | null =
    null;

  function flushMarkdown(): void {
    const joined = markdown.join("\n");
    if (joined.trim()) segments.push({ kind: "markdown", text: joined });
    markdown = [];
  }

  for (const line of text.split("\n")) {
    const match = FENCE.exec(line);
    if (!fence) {
      if (match) {
        const marker = match[1];
        const language = match[2].trim().split(/\s+/u)[0]?.toLowerCase();
        const isInterface =
          marker.startsWith("`") && language === INTELLIGENT_UI_FENCE_LANGUAGE;
        fence = { marker, isInterface, body: [] };
        if (isInterface) {
          flushMarkdown();
          continue;
        }
      }
      markdown.push(line);
      continue;
    }

    const closes =
      match !== null &&
      match[1][0] === fence.marker[0] &&
      match[1].length >= fence.marker.length &&
      match[2].trim() === "";
    if (fence.isInterface) {
      if (closes) {
        segments.push({
          kind: "interface",
          code: fence.body.join("\n"),
          closed: true,
        });
        fence = null;
      } else {
        fence.body.push(line);
      }
    } else {
      markdown.push(line);
      if (closes) fence = null;
    }
  }

  if (fence?.isInterface) {
    segments.push({
      kind: "interface",
      code: fence.body.join("\n"),
      closed: false,
    });
  }
  flushMarkdown();
  return segments;
}
