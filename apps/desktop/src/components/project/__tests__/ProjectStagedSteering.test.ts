import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  serializeAttachmentMessage,
  type PineAttachment,
} from "@/shared/attachments";
import ProjectStagedSteering from "../ProjectStagedSteering.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function mountSteering(
  messages: readonly string[],
  openAttachment?: ReturnType<typeof vi.fn>,
) {
  const wrapper = mount(ProjectStagedSteering, {
    props: { steeringMessages: messages },
    global: { plugins: [createAppI18n("zh-CN")] },
  });
  wrappers.push(wrapper);
  if (openAttachment) {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openAttachment },
    });
  }
  return wrapper;
}

it("keeps the gap the transcript tail cancels above it", () => {
  const wrapper = mountSteering(["改用更小的接口"]);

  expect(
    wrapper.get('[data-slot="staged-steering-messages"]').classes(),
  ).toContain("mt-8");
});

it("renders queued steering as a withdrawable dashed user bubble", async () => {
  const wrapper = mountSteering(["改用更小的接口"]);
  const staged = wrapper.get('[data-slot="staged-steering-message"]');
  const withdraw = staged.get('button[aria-label="撤回暂存消息"]');

  expect(staged.text()).toContain("改用更小的接口");
  expect(staged.get('[data-slot="bubble-content"]').classes()).toContain(
    "border-dashed",
  );
  expect(
    withdraw.element.compareDocumentPosition(
      staged.get('[data-slot="bubble"]').element,
    ) & Node.DOCUMENT_POSITION_PRECEDING,
  ).toBeTruthy();

  await withdraw.trigger("click");
  expect(wrapper.emitted("withdrawSteering")).toEqual([["改用更小的接口"]]);
});

it("labels the staged message actions and sends one now", async () => {
  const wrapper = mountSteering(["改用更小的接口"]);
  const staged = wrapper.get('[data-slot="staged-steering-message"]');
  const withdraw = staged.get('button[aria-label="撤回暂存消息"]');
  const sendNow = staged.get('button[aria-label="立即发送暂存消息"]');

  expect(withdraw.text()).toBe("撤回");
  expect(sendNow.text()).toBe("立即发送");
  expect(
    withdraw.element.compareDocumentPosition(sendNow.element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await sendNow.trigger("click");
  expect(wrapper.emitted("sendSteeringNow")).toEqual([["改用更小的接口"]]);
  expect(wrapper.emitted("withdrawSteering")).toBeUndefined();
});

it("shows attachments of queued steering messages and opens them", async () => {
  const openAttachment = vi.fn().mockResolvedValue({ opened: true });
  const attachment: PineAttachment = {
    extension: "md",
    modifiedAt: "2026-09-02T12:00:00.000Z",
    name: "notes.md",
    path: "/Users/example/notes.md",
    size: 1_024,
  };
  const message = serializeAttachmentMessage([attachment], "看看这个");
  const wrapper = mountSteering([message], openAttachment);
  const staged = wrapper.get('[data-slot="staged-steering-message"]');

  expect(staged.text()).toContain("notes.md");
  expect(staged.get('[data-slot="bubble"] .whitespace-pre-wrap').text()).toBe(
    "看看这个",
  );
  await wrapper.get('[data-slot="attachment-trigger"]').trigger("click");
  await vi.waitFor(() =>
    expect(openAttachment).toHaveBeenCalledWith({
      path: "/Users/example/notes.md",
    }),
  );
});
