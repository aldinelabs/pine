import { describe, expect, it } from "vitest";
import {
  announcedContextNotices,
  contextNoticeMessage,
  PINE_CONTEXT_NOTICE,
  type PineContextNoticeChanges,
} from "../context-notices";

function notice(notices: PineContextNoticeChanges) {
  return {
    role: "custom",
    customType: PINE_CONTEXT_NOTICE,
    content: "",
    display: false,
    details: { notices },
  };
}

describe("context notices", () => {
  it("announces every notice in a new conversation", () => {
    const message = contextNoticeMessage([], {
      user_profile: "profile",
      skills: "skills",
    });

    expect(message?.details.notices).toEqual({
      user_profile: "profile",
      skills: "skills",
    });
    expect(message?.display).toBe(false);
    expect(message?.content).toContain(
      "<user_profile>\nprofile\n</user_profile>",
    );
    expect(message?.content.indexOf("<user_profile>")).toBeLessThan(
      message?.content.indexOf("<skills>") ?? -1,
    );
  });

  it("stays quiet while nothing changes", () => {
    const messages = [
      notice({ user_profile: "profile" }),
      { role: "user", content: "hi" },
    ];

    expect(
      contextNoticeMessage(messages, { user_profile: "profile" }),
    ).toBeUndefined();
  });

  it("announces only what changed", () => {
    const messages = [
      notice({ user_profile: "profile", approximate_location: "Paris" }),
    ];

    const message = contextNoticeMessage(messages, {
      user_profile: "profile",
      approximate_location: "Berlin",
    });

    expect(message?.details.notices).toEqual({
      approximate_location: "Berlin",
    });
    expect(message?.content).not.toContain("<user_profile>");
  });

  it("withdraws a notice that no longer applies", () => {
    const messages = [notice({ approximate_location: "Paris" })];

    const message = contextNoticeMessage(messages, {});

    expect(message?.details.notices).toEqual({ approximate_location: null });
    expect(message?.content).toContain("no longer applies");
    expect(
      announcedContextNotices([
        ...messages,
        notice({ approximate_location: null }),
      ]),
    ).toEqual({});
  });

  it("replays later notices over earlier ones and ignores other messages", () => {
    const messages = [
      notice({ user_profile: "old", skills: "skills" }),
      {
        role: "custom",
        customType: "other",
        details: { notices: { skills: "x" } },
      },
      notice({ user_profile: "new" }),
    ];

    expect(announcedContextNotices(messages)).toEqual({
      user_profile: "new",
      skills: "skills",
    });
  });
});
