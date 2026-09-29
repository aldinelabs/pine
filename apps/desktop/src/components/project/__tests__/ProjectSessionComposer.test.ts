import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { BrainCircuitIcon, ShieldCheckIcon } from "@lucide/vue";
import { createAppI18n, type AppLocale } from "@/app/i18n";
import {
  PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES,
  type PineAttachment,
} from "@/shared/attachments";
import type { PineThinkingLevel } from "@/shared/models";
import { useModelsStore } from "@/stores/models";
import type { PinePendingApproval } from "@/stores/session";
import ProjectApprovalCard from "../ProjectApprovalCard.vue";
import ProjectSessionComposer from "../ProjectSessionComposer.vue";

interface ComposerProps {
  approvalMode?: "let-me-review" | "auto-approve" | "autonomous" | "YOLO";
  isRunning?: boolean;
  isActive?: boolean;
  pendingApproval?: PinePendingApproval | null;
  steeringMessages?: readonly string[];
}

function mountComposer(
  props: ComposerProps = {},
  thinkingLevel: PineThinkingLevel = "high",
  locale: AppLocale = "zh-CN",
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const catalog = {
    providers: [
      {
        authMethods: [{ type: "api_key" as const, label: "API key" }],
        configured: true,
        id: "anthropic",
        modelCount: 1,
        name: "Anthropic",
      },
    ],
    models: [
      {
        api: "anthropic-messages",
        contextWindow: 200_000,
        id: "claude-sonnet",
        input: ["text" as const],
        maxTokens: 32_000,
        name: "Claude Sonnet",
        providerId: "anthropic",
        providerName: "Anthropic",
        reasoning: true,
        supportedThinkingLevels: [
          "off" as const,
          "high" as const,
          "max" as const,
        ],
      },
    ],
    selection: {
      modelId: "claude-sonnet",
      providerId: "anthropic",
      thinkingLevel,
    },
    recommendedModelIds: ["claude-sonnet"],
  };
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getModelCatalog: () => Promise.resolve(catalog),
      selectModel: vi.fn().mockResolvedValue(undefined),
      pickAttachmentFolders: () => Promise.resolve({ attachments: [] }),
      pickAttachments: () => Promise.resolve({ attachments: [] }),
      attachSession: () => Promise.reject(new Error("Not configured")),
    },
  });
  useModelsStore().catalog = catalog;
  return mount(ProjectSessionComposer, {
    props,
    global: {
      plugins: [pinia, createAppI18n(locale)],
      stubs: {
        Tooltip: { template: "<div><slot /></div>" },
        TooltipContent: { template: "<div><slot /></div>" },
        TooltipTrigger: {
          inheritAttrs: false,
          props: ["asChild"],
          template:
            '<span data-test-tooltip-trigger v-bind="$attrs"><slot /></span>',
        },
        SessionSearchOverlay: {
          props: ["open", "purpose"],
          emits: ["select", "update:open"],
          template:
            '<button v-if="open" type="button" data-slot="session-picker-stub" :data-purpose="purpose" @click="$emit(\'select\', { id: \'019cfe51-7166-79b9-a5b9-c652fcca9eab\' })">Select session</button>',
        },
      },
    },
  });
}

describe("ProjectSessionComposer", () => {
  it("shows Autonomous Work with the info semantic color", () => {
    const wrapper = mountComposer({ approvalMode: "autonomous" });
    const trigger = wrapper.get('[data-slot="approval-mode-trigger"]');
    expect(trigger.text()).toContain("自主工作");
    expect(trigger.find(".text-info").exists()).toBe(true);
    expect(trigger.findComponent(BrainCircuitIcon).exists()).toBe(true);
    expect(trigger.findComponent(ShieldCheckIcon).exists()).toBe(false);
    wrapper.unmount();
  });

  it("requires confirmation every time yolo mode is selected", async () => {
    const wrapper = mountComposer();
    const trigger = wrapper.get('[data-slot="approval-mode-trigger"]');

    await trigger.trigger("click");
    await flushPromises();
    const yoloOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((item) => item.textContent?.includes("干就完了"));
    yoloOption?.click();
    await flushPromises();

    expect(trigger.text()).toContain("自动审批");
    expect(wrapper.emitted("update:approvalMode")).toBeUndefined();
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("启用“干就完了”？");
    expect(dialog?.textContent).toContain(
      "即使现代大模型能力已显著提升，其输出仍可能不可预测。启用此选项意味着你需自行承担数据不可逆损失及其他潜在风险。",
    );

    document
      .querySelector<HTMLElement>('[data-slot="yolo-confirm-action"]')
      ?.click();
    await flushPromises();
    expect(wrapper.emitted("update:approvalMode")).toContainEqual(["YOLO"]);
    expect(trigger.text()).toContain("干就完了");

    await trigger.trigger("click");
    await flushPromises();
    const selectedYoloOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((item) => item.textContent?.includes("干就完了"));
    selectedYoloOption?.click();
    await flushPromises();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    wrapper.unmount();
  });

  it("uses discrete reasoning slider positions and keeps warning tooltips", async () => {
    const wrapper = mountComposer({}, "high");

    await wrapper.get('[data-slot="model-selector-trigger"]').trigger("click");
    await flushPromises();

    const slider = document.querySelector<HTMLElement>(
      '[data-slot="reasoning-effort-slider"]',
    );
    expect(slider).not.toBeNull();
    const thumb = slider?.querySelector<HTMLElement>('[role="slider"]');
    expect(thumb?.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb?.getAttribute("aria-valuemax")).toBe("2");
    expect(thumb?.getAttribute("aria-valuenow")).toBe("1");
    const tooltipTrigger = slider?.querySelector("[data-test-tooltip-trigger]");
    expect(tooltipTrigger).not.toBeNull();
    expect(tooltipTrigger).toBe(thumb);
    expect(slider?.className).toContain("reasoning-effort-slider");
    expect(
      document.querySelector('[data-slot="reasoning-effort-control"]')
        ?.textContent,
    ).not.toContain("关闭");
    expect(
      document.querySelector('[data-slot="reasoning-effort-tooltip"]'),
    ).toBeNull();

    thumb?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    await flushPromises();

    expect(useModelsStore().selection?.thinkingLevel).toBe("max");
    expect(
      document.querySelector('[data-slot="reasoning-effort-tooltip"]')
        ?.textContent,
    ).toContain("“最大”推理强度");

    wrapper.unmount();
  });

  it("disables sending while the message is blank", async () => {
    const wrapper = mountComposer();
    const sendButton = wrapper.get('button[aria-label="发送消息"]');

    expect(sendButton.attributes("disabled")).toBeDefined();

    await wrapper.get("textarea").setValue("  检查当前项目  ");

    expect(sendButton.attributes("disabled")).toBeUndefined();
  });

  it("selects, removes, and submits file metadata above the prompt", async () => {
    const wrapper = mountComposer();
    const selectedAttachments = [
      {
        extension: "md",
        modifiedAt: "2026-09-02T12:00:00.000Z",
        name: "notes.md",
        path: "/Users/example/notes.md",
        size: 1_024,
      },
      {
        extension: "png",
        modifiedAt: "2026-09-02T12:01:00.000Z",
        name: "diagram.png",
        path: "/Users/example/diagram.png",
        size: 2_048,
      },
    ];
    window.pine.pickAttachments = () =>
      Promise.resolve({ attachments: selectedAttachments });

    await wrapper.get('button[aria-label="添加附件"]').trigger("click");
    await flushPromises();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes("添加文件"))
      ?.click();
    await flushPromises();

    expect(wrapper.findAll('[data-slot="attachment"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("notes.md");
    expect(wrapper.text()).not.toContain("/Users/example/notes.md");
    expect(
      wrapper.get('[data-slot="attachment"]').attributes("title"),
    ).toBeUndefined();
    expect(wrapper.find('[data-slot="attachment-trigger"]').exists()).toBe(
      false,
    );

    await wrapper
      .get('button[aria-label="移除附件 notes.md"]')
      .trigger("click");
    expect(wrapper.findAll('[data-slot="attachment"]')).toHaveLength(1);

    await wrapper.get("textarea").setValue("Inspect the diagram.");
    await wrapper.get("form").trigger("submit");

    const submitted = wrapper.emitted("submit")?.[0]?.[0];
    expect(submitted).toBeTypeOf("string");
    expect(submitted).toContain('<pine_attachments version="1">');
    expect(submitted).toContain('"path":"/Users/example/diagram.png"');
    expect(submitted).toMatch(/<\/pine_attachments>\n\nInspect the diagram\.$/);
    expect(wrapper.findAll('[data-slot="attachment"]')).toHaveLength(0);
  });

  it("allows sending attachments without prompt text", async () => {
    const wrapper = mountComposer();
    window.pine.pickAttachments = () =>
      Promise.resolve({
        attachments: [
          {
            extension: "txt",
            modifiedAt: "2026-09-02T12:00:00.000Z",
            name: "context.txt",
            path: "/tmp/context.txt",
            size: 12,
          },
        ],
      });

    await wrapper.get('button[aria-label="添加附件"]').trigger("click");
    await flushPromises();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes("添加文件"))
      ?.click();
    await flushPromises();
    const send = wrapper.get('button[aria-label="发送消息"]');
    expect(send.attributes("disabled")).toBeUndefined();

    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")?.[0]?.[0]).toMatch(
      /<\/pine_attachments>$/,
    );
  });

  it("selects a conversation from the reused session palette and attaches its JSONL file", async () => {
    const wrapper = mountComposer();
    const attachment: PineAttachment = {
      extension: "jsonl",
      kind: "file",
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "Architecture review.jsonl",
      path: "/pine/projects/p1/sessions/session.jsonl",
      size: 2_048,
    };
    const attachSession = vi.fn().mockResolvedValue({ attachment });
    window.pine.attachSession = attachSession;

    await wrapper.get('button[aria-label="添加附件"]').trigger("click");
    await flushPromises();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes("会话"))
      ?.click();
    await vi.waitFor(() => {
      expect(wrapper.get('[data-slot="session-picker-stub"]')).toBeDefined();
    });

    const picker = wrapper.get('[data-slot="session-picker-stub"]');
    expect(picker.attributes("data-purpose")).toBe("attach");
    await picker.trigger("click");
    await flushPromises();

    expect(attachSession).toHaveBeenCalledWith({
      sessionId: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
    });
    expect(wrapper.text()).toContain("Architecture review.jsonl");
    expect(wrapper.emitted("update:attachments")).toContainEqual([
      [attachment],
    ]);
  });

  it("selects a folder as one read-only path attachment", async () => {
    const wrapper = mountComposer();
    window.pine.pickAttachmentFolders = () =>
      Promise.resolve({
        attachments: [
          {
            extension: "",
            kind: "directory",
            modifiedAt: "2026-09-02T12:00:00.000Z",
            name: "references",
            path: "/Users/example/references",
            size: 96,
          },
        ],
      });

    await wrapper.get('button[aria-label="添加附件"]').trigger("click");
    await flushPromises();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes("添加文件夹"))
      ?.click();
    await flushPromises();

    expect(wrapper.text()).toContain("references");
    expect(wrapper.text()).toContain("文件夹");
    expect(wrapper.get('[data-slot="attachment"] svg')).toBeDefined();

    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")?.[0]?.[0]).toContain('"kind":"directory"');
    expect(wrapper.emitted("submit")?.[0]?.[0]).toContain(
      '"path":"/Users/example/references"',
    );
  });

  it("submits a normalized message with Enter", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.setValue("  检查当前项目  ");

    await textarea.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("submit")).toEqual([["检查当前项目"]]);
  });

  it("keeps Shift+Enter and IME Enter available for text input", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.setValue("正在输入");

    await textarea.trigger("keydown", { key: "Enter", shiftKey: true });
    await textarea.trigger("keydown", { key: "Enter", isComposing: true });

    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("turns the send action into a stop action while running", async () => {
    const wrapper = mountComposer({ isRunning: true });
    const stopButton = wrapper.get('button[aria-label="停止回答"]');

    await stopButton.trigger("click");

    expect(wrapper.emitted("abort")).toEqual([[]]);
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("uses steering copy and submits with Enter while running", async () => {
    const wrapper = mountComposer({ isRunning: true });
    const textarea = wrapper.get("textarea");

    expect(textarea.attributes("placeholder")).toBe("追加要求、改变方向……");
    await textarea.setValue("先修复类型错误");

    await textarea.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("submit")).toEqual([["先修复类型错误"]]);
    expect(wrapper.emitted("abort")).toBeUndefined();
  });

  it("renders queued steering as a withdrawable dashed user bubble", async () => {
    const wrapper = mountComposer({
      isRunning: true,
      steeringMessages: ["改用更小的接口"],
    });
    const staged = wrapper.get('[data-slot="staged-steering-message"]');
    const withdraw = staged.get('button[aria-label="撤回暂存消息"]');

    expect(staged.text()).toContain("改用更小的接口");
    expect(
      withdraw.element.compareDocumentPosition(
        staged.get('[data-slot="bubble"]').element,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await withdraw.trigger("click");
    expect(wrapper.emitted("withdrawSteering")).toEqual([["改用更小的接口"]]);
  });

  it("saves pathless pasted images into Pine-managed attachment storage", async () => {
    const wrapper = mountComposer();
    const savedAttachment: PineAttachment = {
      extension: "png",
      kind: "file",
      modifiedAt: "2026-09-02T12:02:00.000Z",
      name: "image.png",
      path: "/pine/projects/p1/attachments/uuid.png",
      size: 4,
    };
    const savePastedAttachment = vi.fn(() =>
      Promise.resolve({ attachment: savedAttachment }),
    );
    window.pine.savePastedAttachment = savePastedAttachment;
    window.pine.getPathForFile = () => {
      throw new Error("Clipboard file has no filesystem path.");
    };
    const pastedImage = {
      name: "image.png",
      type: "image/png",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    } as unknown as File;

    await wrapper
      .get("textarea")
      .trigger("paste", { clipboardData: { files: [pastedImage] } });
    await flushPromises();

    expect(savePastedAttachment).toHaveBeenCalledWith({
      bytes: expect.any(Uint8Array),
      mimeType: "image/png",
      name: "image.png",
    });
    expect(wrapper.emitted("update:attachments")).toContainEqual([
      [savedAttachment],
    ]);
  });

  it("reuses the inspect flow for pasted files with real paths", async () => {
    const wrapper = mountComposer();
    const inspectedAttachment: PineAttachment = {
      extension: "md",
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "notes.md",
      path: "/Users/example/notes.md",
      size: 1_024,
    };
    const inspectAttachments = vi.fn(() =>
      Promise.resolve({ attachments: [inspectedAttachment] }),
    );
    const savePastedAttachment = vi.fn();
    window.pine.inspectAttachments = inspectAttachments;
    window.pine.savePastedAttachment = savePastedAttachment;
    window.pine.getPathForFile = () => "/Users/example/notes.md";
    const copiedFile = {
      name: "notes.md",
      type: "",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as unknown as File;

    await wrapper
      .get("textarea")
      .trigger("paste", { clipboardData: { files: [copiedFile] } });
    await flushPromises();

    expect(inspectAttachments).toHaveBeenCalledWith({
      paths: ["/Users/example/notes.md"],
    });
    expect(savePastedAttachment).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:attachments")).toContainEqual([
      [inspectedAttachment],
    ]);
  });

  it("ignores paste events without clipboard files", async () => {
    const wrapper = mountComposer();
    const inspectAttachments = vi.fn();
    const savePastedAttachment = vi.fn();
    window.pine.inspectAttachments = inspectAttachments;
    window.pine.savePastedAttachment = savePastedAttachment;

    await wrapper
      .get("textarea")
      .trigger("paste", { clipboardData: { files: [] } });
    await flushPromises();

    expect(inspectAttachments).not.toHaveBeenCalled();
    expect(savePastedAttachment).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:attachments")).toBeUndefined();
  });

  it("turns a large plain-text paste into a project attachment", async () => {
    const wrapper = mountComposer();
    const pastedText = "a".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES);
    const savedAttachment: PineAttachment = {
      extension: "txt",
      kind: "file",
      modifiedAt: "2026-09-09T12:00:00.000Z",
      name: "pasted-text.txt",
      path: "/pine/projects/p1/attachments/uuid.txt",
      size: pastedText.length,
    };
    const savePastedAttachment = vi.fn(() =>
      Promise.resolve({ attachment: savedAttachment }),
    );
    window.pine.savePastedAttachment = savePastedAttachment;

    await wrapper.get("textarea").trigger("paste", {
      clipboardData: {
        files: [],
        getData: () => pastedText,
      },
    });
    await flushPromises();

    expect(savePastedAttachment).toHaveBeenCalledWith({
      mimeType: "text/plain",
      name: "pasted-text.txt",
      text: pastedText,
    });
    expect(wrapper.emitted("update:attachments")).toContainEqual([
      [savedAttachment],
    ]);
    expect(wrapper.get("textarea").element.value).toBe("");
  });

  it("leaves text below the large-paste threshold to the native paste path", async () => {
    const wrapper = mountComposer();
    const savePastedAttachment = vi.fn();
    window.pine.savePastedAttachment = savePastedAttachment;

    await wrapper.get("textarea").trigger("paste", {
      clipboardData: {
        files: [],
        getData: () => "short paste",
      },
    });
    await flushPromises();

    expect(savePastedAttachment).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:attachments")).toBeUndefined();
  });

  it("restores a large paste to the message when attachment saving fails", async () => {
    const wrapper = mountComposer();
    const pastedText = "a".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES);
    window.pine.savePastedAttachment = vi
      .fn()
      .mockRejectedValue(new Error("disk full"));
    await wrapper.get("textarea").setValue("before after");
    const textarea = wrapper.get("textarea").element;
    textarea.setSelectionRange(7, 7);

    await wrapper.get("textarea").trigger("paste", {
      clipboardData: {
        files: [],
        getData: () => pastedText,
      },
    });
    await flushPromises();

    expect(wrapper.get("textarea").element.value).toBe(
      `before ${pastedText}after`,
    );
    expect(wrapper.emitted("update:attachments")).toBeUndefined();
  });
  it("gives consecutive approval cards independent guidance and response state", async () => {
    const approval: PinePendingApproval = {
      requestId: "first",
      toolCallId: "tool-1",
      toolName: "bash",
      trigger: "pre-execution",
    };
    const wrapper = mountComposer(
      { pendingApproval: approval },
      "high",
      "en-US",
    );
    const firstCard = wrapper.getComponent(ProjectApprovalCard);
    await firstCard
      .findAll("button")
      .find((button) => button.text().includes("Reject with guidance"))!
      .trigger("click");
    await firstCard.get("input").setValue("Use another command");
    await firstCard.get("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("respond")?.[0]).toEqual([
      "guide",
      "Use another command",
    ]);
    await wrapper.setProps({
      pendingApproval: {
        ...approval,
        requestId: "second",
        toolCallId: "tool-2",
      },
    });
    const secondCard = wrapper.getComponent(ProjectApprovalCard);
    expect(secondCard.vm).not.toBe(firstCard.vm);
    expect(secondCard.find("input").exists()).toBe(false);
    await secondCard
      .findAll("button")
      .find((button) => button.text().includes("Approve"))!
      .trigger("click");
    expect(wrapper.emitted("respond")?.[1]).toEqual(["approve", undefined]);
    wrapper.unmount();
  });

  it("ignores approval shortcuts in a hidden tab", async () => {
    const approval: PinePendingApproval = {
      requestId: "first",
      toolCallId: "tool-1",
      toolName: "bash",
      trigger: "pre-execution",
    };
    const wrapper = mountComposer(
      { pendingApproval: approval, isActive: false },
      "high",
      "en-US",
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(wrapper.emitted("respond")).toBeUndefined();
    await wrapper.setProps({ isActive: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(wrapper.emitted("respond")?.[0]).toEqual(["approve", undefined]);
    wrapper.unmount();
  });
});
