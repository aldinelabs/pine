import type { AssistantMessage, Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const MAX_GENERATED_TITLE_LENGTH = 60;
export const TITLE_TOOL: Tool = {
  name: "submit_title",
  description:
    "Submit a short, high-level conversation title. Call this exactly once and do not answer in plain text.",
  parameters: Type.Object(
    {
      title: Type.String({
        description:
          "A concise, informative title in the requested language. Preserve complete meaning and names that identify the topic; use at most 60 characters.",
        minLength: 1,
        maxLength: MAX_GENERATED_TITLE_LENGTH,
      }),
    },
    { additionalProperties: false },
  ),
};

export function normalizeGeneratedTitle(value: string): string | undefined {
  const title = value
    .trim()
    .split(/\r?\n/, 1)[0]
    ?.replace(/^['"`“”「」『』]+|['"`“”「」『』]+$/g, "")
    ?.replace(/[.!?。！？]+$/, "")
    .trim();
  if (!title) return undefined;
  return [...title].slice(0, MAX_GENERATED_TITLE_LENGTH).join("");
}

export function titleFromAssistantMessage(
  message: AssistantMessage | undefined,
): string | undefined {
  const call = message?.content.find(
    (block) => block.type === "toolCall" && block.name === TITLE_TOOL.name,
  );
  if (
    call?.type !== "toolCall" ||
    typeof call.arguments !== "object" ||
    call.arguments === null ||
    Array.isArray(call.arguments) ||
    Object.keys(call.arguments).some((key) => key !== "title") ||
    typeof (call.arguments as { title?: unknown }).title !== "string"
  ) {
    return undefined;
  }
  return normalizeGeneratedTitle((call.arguments as { title: string }).title);
}
