import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  languageName,
  liveTranslationContext,
  liveTranslationsFromAssistantMessage,
} from "../live-translation";

function reply(text: string): AssistantMessage {
  return { content: [{ type: "text", text }] } as unknown as AssistantMessage;
}

describe("live translation prompt", () => {
  it("names the languages and numbers each segment, with earlier ones as context", () => {
    const context = liveTranslationContext({
      language: "fr-FR",
      sourceLanguage: "en-US",
      context: [{ text: "Hi Ana.", translation: "Salut Ana." }],
      segments: ["Open <App.vue> & check", "Thanks."],
    });
    expect(context.systemPrompt).toContain("into French");
    expect(context.systemPrompt).toContain("Never add commentary");
    expect(context.systemPrompt).toContain("proper nouns");
    const [message] = context.messages;
    expect(message.role).toBe("user");
    const content = message.content as string;
    expect(content).toContain(
      "<earlier_segments>\n<s>Hi Ana.</s>\n<t>Salut Ana.</t>\n</earlier_segments>",
    );
    expect(content).toContain("transcribed as English.");
    expect(content).toContain(
      '<s n="1">Open &lt;App.vue&gt; &amp; check</s>\n<s n="2">Thanks.</s>',
    );
  });

  it("leaves out context when there is none", () => {
    const content = liveTranslationContext({
      language: "ja-JP",
      context: [],
      segments: ["Hello"],
    }).messages[0].content as string;
    expect(content).not.toContain("earlier_segments");
    expect(content.startsWith("Translate these segments into Japanese.")).toBe(
      true,
    );
  });

  it("maps the reply back to segments, in order, with gaps empty", () => {
    expect(
      liveTranslationsFromAssistantMessage(
        reply(
          'Sure!\n<t n="2">Merci.</t>\n<t n="1">Ouvre &lt;App.vue&gt;</t>\n<t n="7">extra</t>',
        ),
        3,
      ),
    ).toEqual(["Ouvre <App.vue>", "Merci.", ""]);
    expect(liveTranslationsFromAssistantMessage(undefined, 2)).toEqual([
      "",
      "",
    ]);
  });

  it("falls back to the code for an unknown language", () => {
    expect(languageName("de-DE")).toBe("German");
    expect(languageName("zh-TW")).toBe("Traditional Chinese");
    expect(languageName("zh-CN")).toBe("Simplified Chinese");
    expect(languageName("not a locale")).toBe("not a locale");
  });
});
