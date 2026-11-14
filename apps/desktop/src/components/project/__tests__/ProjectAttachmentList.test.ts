import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { sessionAttachment, type PineAttachment } from "@/shared/attachments";
import ProjectAttachmentList from "../ProjectAttachmentList.vue";

const imageAttachment: PineAttachment = {
  extension: "png",
  kind: "file",
  modifiedAt: "2026-09-02T12:02:00.000Z",
  name: "screenshot.png",
  path: "/pine/projects/p1/attachments/uuid.png",
  size: 2_048,
};

const fileAttachment: PineAttachment = {
  extension: "md",
  kind: "file",
  modifiedAt: "2026-09-02T12:00:00.000Z",
  name: "notes.md",
  path: "/Users/example/notes.md",
  size: 1_024,
};

function mountList(props: {
  attachments: readonly PineAttachment[];
  removable?: boolean;
  surface: "composer" | "message";
}) {
  return mount(ProjectAttachmentList, {
    props,
    global: {
      plugins: [createAppI18n("zh-CN")],
    },
  });
}

describe("ProjectAttachmentList", () => {
  it.each(["composer", "message"] as const)(
    "shows source line ranges on the %s card",
    (surface) => {
      const wrapper = mountList({
        attachments: [
          {
            ...fileAttachment,
            selection: { startLine: 3, endLine: 12, text: "selected" },
          },
        ],
        surface,
      });
      expect(wrapper.get('[data-slot="attachment-description"]').text()).toBe(
        "第 3–12 行",
      );
      expect(wrapper.text()).not.toContain("MD ·");
    },
  );

  it("shows an attached conversation by its title and project", () => {
    const session = sessionAttachment({
      projectId: "p1",
      sessionId: "s1",
      projectName: "Pine",
      title: "",
      updatedAt: "2026-09-02T12:00:00.000Z",
    });
    const wrapper = mountList({ attachments: [session], surface: "composer" });
    expect(wrapper.get('[data-slot="attachment-title"]').text()).toBe(
      "未命名会话",
    );
    expect(wrapper.get('[data-slot="attachment-description"]').text()).toBe(
      "Pine",
    );
  });

  it("shows a rendered-document location instead of source lines", () => {
    const wrapper = mountList({
      attachments: [
        {
          ...fileAttachment,
          selection: {
            startLine: 1,
            endLine: 2,
            label: "选中内容 · Sheet1!A1:B2",
            text: "名称\t值",
          },
        },
      ],
      surface: "composer",
    });

    expect(wrapper.get('[data-slot="attachment-description"]').text()).toBe(
      "选中内容 · Sheet1!A1:B2",
    );
  });

  it("falls back to the icon variant when the preview fails to load", async () => {
    const wrapper = mountList({
      attachments: [imageAttachment],
      surface: "message",
    });

    await wrapper.get("img").trigger("error");

    const media = wrapper.get('[data-slot="attachment-media"]');
    expect(media.attributes("data-variant")).toBeUndefined();
    expect(wrapper.find("img").exists()).toBe(false);
  });
});
