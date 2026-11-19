import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { BrainCircuitIcon, ShieldCheckIcon } from "@lucide/vue";
import { createAppI18n, type AppLocale } from "@/app/i18n";
import {
  PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES,
  type PineAttachment,
} from "@/shared/attachments";
import { monoIconSource, resolveProviderIcon } from "@/lib/provider-icons";
import type { PineThinkingLevel } from "@/shared/models";
import {
  COMPOSER_GLOW_STORAGE_KEY,
  useAppearanceStore,
} from "@/stores/appearance";
import { useModelsStore } from "@/stores/models";
import { useSessionStore } from "@/stores/session";
import { showProject } from "@/stores/__tests__/showProject";
import { useProjectStore } from "@/stores/project";
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import type { AutomationApprovalRequest } from "@/shared/automation";
import type { PinePendingApproval } from "@/stores/session";
import AutomationApprovalCard from "@/components/automations/AutomationApprovalCard.vue";
import ProjectApprovalCard from "../ProjectApprovalCard.vue";
import ProjectSessionComposer from "../ProjectSessionComposer.vue";
import { MODIFIER_HOLD_DELAY_MS } from "@/composables/useModifierHold";

interface ComposerProps {
  edgeInset?: boolean;
  context?: PineAttachment[];
  approvalMode?: "let-me-review" | "auto-approve" | "autonomous" | "YOLO";
  isRunning?: boolean;
  isActive?: boolean;
  sessionId?: string;
  pendingApproval?: PinePendingApproval | null;
  pendingAutomationApproval?: AutomationApprovalRequest | null;
}

const WORKING_BORDER = '[data-slot="session-composer-working-border"]';

function mountComposer(
  props: ComposerProps = {},
  thinkingLevel: PineThinkingLevel = "high",
  locale: AppLocale = "zh-CN",
  pine: Record<string, unknown> = {},
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
      ...pine,
    },
  });
  useModelsStore().catalog = catalog;
  return mount(ProjectSessionComposer, {
    props: { projectId: "project-1", ...props },
    attachTo: document.body,
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
            '<button v-if="open" type="button" data-slot="session-picker-stub" :data-purpose="purpose" @click="$emit(\'select\', { id: \'019cfe51-7166-79b9-a5b9-c652fcca9eab\', projectId: \'project-2\' })">Select session</button>',
        },
      },
    },
  });
}

function testProject(id: string, name: string): PineProject {
  return {
    createdAt: "",
    defaultFolderId: "folder",
    folders: [],
    id,
    name,
    schemaVersion: 1,
    updatedAt: "",
  };
}

async function mountChooser() {
  const wrapper = mountComposer({ isActive: true });
  const projectStore = useProjectStore();
  showProject(testProject(TEMPORARY_WORKSPACE_PROJECT_ID, "Temporary"));
  projectStore.projects = [
    testProject(TEMPORARY_WORKSPACE_PROJECT_ID, "Temporary"),
    testProject("courses", "Courses"),
    testProject("pine", "Pine"),
    testProject("recipes", "Recipes"),
  ];
  const ensureOpen = vi
    .spyOn(projectStore, "ensureOpen")
    .mockResolvedValue({ opened: true } as never);
  await wrapper.setProps({ projectId: TEMPORARY_WORKSPACE_PROJECT_ID });
  const input = wrapper.get("textarea");
  await input.trigger("focus");
  await flushPromises();
  return { wrapper, input, ensureOpen };
}

function optionNames(): string[] {
  return Array.from(
    document.querySelectorAll('[data-slot="project-name-option"]'),
  ).map((option) => option.textContent?.trim() ?? "");
}

describe("ProjectSessionComposer", () => {
  it("turns a leading @ into project suggestions and chooses with Enter", async () => {
    const { wrapper, input, ensureOpen } = await mountChooser();
    expect(input.attributes("placeholder")).toBe("描述任务，或输入 @ 选择项目");
    await input.setValue("hello @pine");
    expect(input.attributes("role")).toBeUndefined();
    expect(optionNames()).toEqual([]);
    await input.setValue("");

    await input.setValue("@");
    await flushPromises();
    // The "@" becomes the input's icon instead of text.
    expect((input.element as HTMLTextAreaElement).value).toBe("");
    expect(input.attributes("role")).toBe("combobox");
    expect(input.attributes("placeholder")).toBe("输入项目名称……");
    expect(wrapper.find('[data-slot="project-chooser-chip"]').exists()).toBe(
      true,
    );
    expect(optionNames()).toEqual(["无项目", "Courses", "Pine", "Recipes"]);
    await input.setValue("pe");
    // Names starting with the query come before names containing it.
    expect(optionNames()).toEqual(["Recipes"]);
    await input.setValue("p");
    expect(optionNames()).toEqual(["Pine", "Recipes"]);
    expect(
      wrapper.get('button[aria-label="发送消息"]').attributes("disabled"),
    ).toBeDefined();
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(ensureOpen).toHaveBeenCalledWith("recipes");
    expect(wrapper.emitted("selectProject")).toEqual([["recipes"]]);
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
    expect(input.attributes("role")).toBeUndefined();
    wrapper.unmount();
  });

  it("leaves project suggestions with Escape or Backspace and never sends a name", async () => {
    const { wrapper, input } = await mountChooser();
    await input.setValue("@");
    await flushPromises();
    await input.setValue("zzz");
    expect(document.body.textContent).toContain("没有匹配的项目");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.emitted("selectProject")).toBeUndefined();
    expect(wrapper.emitted("submit")).toBeUndefined();

    // Escape keeps the text as the message.
    await input.trigger("keydown", { key: "Escape" });
    expect(input.attributes("role")).toBeUndefined();
    expect((input.element as HTMLTextAreaElement).value).toBe("zzz");

    await input.setValue("");
    await input.setValue("@");
    await flushPromises();
    expect(input.attributes("role")).toBe("combobox");
    await input.trigger("keydown", { key: "Backspace" });
    expect(input.attributes("role")).toBeUndefined();
    wrapper.unmount();
  });

  it("shows context on its own and drops it with Backspace or \\ in an empty message", async () => {
    const wrapper = mountComposer({
      isActive: true,
      context: [
        {
          extension: "txt",
          kind: "file",
          modifiedAt: "2026-10-30T00:00:00.000Z",
          name: "Hello.txt",
          path: "/tmp/hello.txt",
          size: 5,
          selection: { startLine: 1, endLine: 1, text: "Hello" },
          source: { app: "Notes", windowTitle: "Ideas" },
        },
      ],
    });
    const strip = wrapper.find('[data-slot="composer-context"]');
    expect(strip.text()).toContain("Notes");
    expect(strip.text()).toContain("Ideas");
    expect(strip.text()).toContain("Hello");
    // It is not shown as an ordinary attachment.
    expect(wrapper.text()).not.toContain("Hello.txt");
    const input = wrapper.find("textarea");
    await input.trigger("keydown", { key: "Backspace" });
    await input.trigger("keydown", { key: "\\" });
    expect(wrapper.emitted("dismissContext")).toHaveLength(2);

    await input.setValue("a");
    await input.trigger("keydown", { key: "Backspace" });
    await input.trigger("keydown", { key: "\\" });
    expect(wrapper.emitted("dismissContext")).toHaveLength(2);
    wrapper.unmount();

    const plain = mountComposer({ isActive: true });
    await plain.find("textarea").trigger("keydown", { key: "Backspace" });
    expect(plain.emitted("dismissContext")).toBeUndefined();
    plain.unmount();
  });

  it("holds the controls below the input in while inset", async () => {
    const wrapper = mountComposer({ isActive: true, edgeInset: true });
    const footer = () => wrapper.find('[data-slot="session-composer-footer"]');
    expect(footer().classes()).toContain("session-composer-footer--edge-inset");
    await wrapper.setProps({ edgeInset: false });
    expect(footer().classes()).not.toContain(
      "session-composer-footer--edge-inset",
    );
    wrapper.unmount();
  });

  it("focuses the prompt with Cmd+L or Ctrl+L", () => {
    const wrapper = mountComposer({ isActive: true });
    const textarea = wrapper.find("textarea").element;
    const button = wrapper.find("button").element;
    button.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);

    const cmdL = new KeyboardEvent("keydown", {
      key: "l",
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(cmdL);
    expect(cmdL.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(textarea);

    button.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", ctrlKey: true }),
    );
    expect(document.activeElement).toBe(textarea);
    wrapper.unmount();
  });

  it("shows the selected model's single-colour provider icon in the model trigger", () => {
    const wrapper = mountComposer();
    const icon = wrapper.get(
      '[data-slot="model-selector-trigger"] [data-slot="provider-icon"]',
    );
    const expected = resolveProviderIcon("anthropic");

    expect(icon.element.tagName).toBe("SPAN");
    expect(icon.attributes("data-variant")).toBe("mono");
    expect(icon.attributes("data-icon")).toBe("inline-start");
    expect(icon.attributes("style")).toContain(
      expected ? monoIconSource(expected) : "missing",
    );
  });

  it("lets a narrow footer compact the model control instead of overlapping", () => {
    const wrapper = mountComposer();
    const footer = wrapper.get('[data-slot="session-composer-footer"]');
    // The footer is the container its compact states query.
    expect(footer.classes()).toContain("@container/composer-footer");
    expect(footer.get("div").classes()).toContain("shrink-0");

    const model = footer.get('[data-slot="model-selector-trigger"]');
    // Buttons default to shrink-0; the Model control must give way.
    expect(model.classes()).toEqual(
      expect.arrayContaining(["min-w-0", "shrink"]),
    );
    expect(model.attributes("aria-label")).toBe("Claude Sonnet · 高");
    expect(model.get('[data-slot="model-selector-name"]').classes()).toEqual(
      expect.arrayContaining([
        "session-composer-model-name",
        "min-w-0",
        "truncate",
      ]),
    );
    expect(
      model.get('[data-slot="model-selector-thinking-level"]').classes(),
    ).toContain("session-composer-thinking-level");
    wrapper.unmount();
  });

  it("opens the approval mode menu with Cmd+R and the model menu with Cmd+I", async () => {
    const wrapper = mountComposer({ isActive: true });
    const approval = wrapper.get('[data-slot="approval-mode-trigger"]');
    const model = wrapper.get('[data-slot="model-selector-trigger"]');
    expect(approval.attributes("aria-expanded")).toBe("false");

    const cmdBracket = new KeyboardEvent("keydown", {
      key: "r",
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(cmdBracket);
    await flushPromises();
    expect(cmdBracket.defaultPrevented).toBe(true);
    expect(approval.attributes("aria-expanded")).toBe("true");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "i", ctrlKey: true }),
    );
    await flushPromises();
    expect(model.attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });

  it("leaves Cmd+R to text fields outside the composer", async () => {
    const wrapper = mountComposer({ isActive: true });
    const field = document.createElement("input");
    document.body.append(field);
    const cmdR = new KeyboardEvent("keydown", {
      key: "r",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(cmdR);
    await flushPromises();
    expect(cmdR.defaultPrevented).toBe(false);
    expect(
      wrapper
        .get('[data-slot="approval-mode-trigger"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    field.remove();
    wrapper.unmount();
  });

  it("shows the menu shortcuts while Cmd is held", async () => {
    vi.useFakeTimers();
    const wrapper = mountComposer({ isActive: true });
    expect(wrapper.find('[data-slot="approval-menu-shortcut"]').exists()).toBe(
      false,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    vi.advanceTimersByTime(MODIFIER_HOLD_DELAY_MS);
    await nextTick();
    expect(wrapper.get('[data-slot="approval-menu-shortcut"]').text()).toBe(
      "⌘R",
    );
    expect(wrapper.get('[data-slot="model-menu-shortcut"]').text()).toBe("⌘I");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    await nextTick();
    expect(wrapper.find('[data-slot="model-menu-shortcut"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("ignores Cmd+L and Cmd+R in a hidden tab", async () => {
    const wrapper = mountComposer({ isActive: false });
    const button = wrapper.find("button").element;
    button.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", metaKey: true }),
    );
    expect(document.activeElement).toBe(button);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", metaKey: true }),
    );
    await flushPromises();
    expect(
      wrapper
        .get('[data-slot="approval-mode-trigger"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    wrapper.unmount();
  });

  it("does not suggest projects in an existing session", async () => {
    const { wrapper, input } = await mountChooser();
    await wrapper.setProps({ sessionId: "session-1" });
    await input.setValue("@p");
    expect(input.attributes("role")).toBeUndefined();
    expect(optionNames()).toEqual([]);
    wrapper.unmount();
  });

  it("shows Autonomous Work with its own icon", () => {
    const wrapper = mountComposer({ approvalMode: "autonomous" });
    const trigger = wrapper.get('[data-slot="approval-mode-trigger"]');
    expect(trigger.text()).toContain("自主工作");
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
      projectId: "project-2",
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

  it("sends without moving the transcript with Option+Enter", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.setValue("稍后再看");

    await textarea.trigger("keydown", { key: "Enter", altKey: true });

    expect(wrapper.emitted("submit")).toEqual([
      ["稍后再看", { holdView: true }],
    ]);
  });

  it("optimizes instead of sending with Ctrl+Enter, and ignores Cmd+Option+Enter", async () => {
    const rewritePrompt = vi.fn(() => new Promise(() => undefined));
    const wrapper = mountComposer({}, "high", "zh-CN", { rewritePrompt });
    const textarea = wrapper.get("textarea");
    await textarea.setValue("写个周报");

    await textarea.trigger("keydown", {
      key: "Enter",
      metaKey: true,
      altKey: true,
    });
    expect(rewritePrompt).not.toHaveBeenCalled();

    await textarea.trigger("keydown", { key: "Enter", ctrlKey: true });
    expect(rewritePrompt).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("submit")).toBeUndefined();
    wrapper.unmount();
  });

  it("sends like Enter from the Send button", async () => {
    const wrapper = mountComposer();
    await wrapper.get("textarea").setValue("检查当前项目");

    await wrapper.get('button[aria-label="发送消息"]').trigger("click");

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

  it("submits with Enter while running and keeps steering copy", async () => {
    const wrapper = mountComposer({ isRunning: true });
    const textarea = wrapper.get("textarea");

    expect(textarea.attributes("placeholder")).toBe("追加要求、改变方向……");
    await textarea.setValue("先修复类型错误");

    await textarea.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("submit")).toEqual([["先修复类型错误"]]);
    expect(wrapper.emitted("abort")).toBeUndefined();
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
      projectId: "project-1",
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
      projectId: "project-1",
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
    await firstCard.get("textarea").setValue("Use another command");
    await firstCard.get("textarea").trigger("keydown", {
      key: "Enter",
      isComposing: true,
    });
    expect(wrapper.emitted("respond")).toBeUndefined();
    await firstCard.get("textarea").trigger("keydown", { key: "Enter" });
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
    expect(secondCard.find("textarea").exists()).toBe(false);
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

  it("replaces the input with an automation approval answered by shortcut", () => {
    const respondApproval = vi.fn(() => Promise.resolve());
    const approval: AutomationApprovalRequest = {
      requestId: "automation-1",
      projectId: "project-1",
      projectName: "Docs",
      kind: "create",
      facts: {
        name: "Daily summary",
        triggers: [],
        read: [],
        write: [],
        network: [],
        tools: ["read"],
        mcp: [],
        secrets: [],
        skills: [],
        notify: "on-findings",
        outputs: [],
        limits: { maxRunsPerDay: 100, maxMinutesPerRun: 10 },
      },
      warnings: [],
      createdAt: "2026-11-03T00:00:00.000Z",
    };
    const wrapper = mountComposer(
      { pendingAutomationApproval: approval, isActive: true },
      "high",
      "en-US",
      { runtime: "desktop", automations: { respondApproval } },
    );
    expect(wrapper.findComponent(AutomationApprovalCard).exists()).toBe(true);
    expect(wrapper.find("textarea").exists()).toBe(false);
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ...options }),
      );
    }
    expect(respondApproval).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(respondApproval).toHaveBeenCalledWith({
      requestId: "automation-1",
      approve: true,
    });
    wrapper.unmount();
  });

  it("rejects an automation approval with guidance", async () => {
    const respondApproval = vi.fn(() => Promise.resolve());
    const wrapper = mountComposer(
      {
        pendingAutomationApproval: {
          requestId: "automation-2",
          projectId: "project-1",
          projectName: "Docs",
          kind: "create",
          facts: {
            name: "Daily summary",
            triggers: [],
            read: [],
            write: [],
            network: [],
            tools: ["read"],
            mcp: [],
            secrets: [],
            skills: [],
            notify: "on-findings",
            outputs: [],
            limits: { maxRunsPerDay: 100, maxMinutesPerRun: 10 },
          },
          warnings: [],
          createdAt: "2026-11-03T00:00:00.000Z",
        },
        isActive: true,
      },
      "high",
      "en-US",
      { runtime: "desktop", automations: { respondApproval } },
    );
    const card = wrapper.getComponent(AutomationApprovalCard);
    await card
      .findAll("button")
      .find((button) => button.text().includes("Reject with guidance"))!
      .trigger("click");
    await card.get("textarea").setValue("Only on weekdays");
    await card.get("textarea").trigger("keydown", {
      key: "Enter",
      isComposing: true,
    });
    expect(respondApproval).not.toHaveBeenCalled();
    await card.get("textarea").trigger("keydown", { key: "Enter" });
    expect(respondApproval).toHaveBeenCalledWith({
      requestId: "automation-2",
      approve: false,
      guidance: "Only on weekdays",
    });
    wrapper.unmount();
  });
  it("lights the text box's border while the active session works", () => {
    const wrapper = mountComposer({ isRunning: true, isActive: true });
    const border = wrapper.find(
      '.session-composer-control > [data-slot="session-composer-working-border"]',
    );
    expect(border.exists()).toBe(true);
    expect(border.attributes("data-state")).toBe("on");
    expect(
      wrapper
        .find(
          '.session-composer-control > [data-slot="session-composer-working-border-glow"]',
        )
        .exists(),
    ).toBe(true);
    wrapper.unmount();
  });
  it("shows no working border when idle or in a background tab", () => {
    const idle = mountComposer({ isRunning: false, isActive: true });
    expect(idle.find(WORKING_BORDER).exists()).toBe(false);
    idle.unmount();
    const background = mountComposer({ isRunning: true, isActive: false });
    expect(background.find(WORKING_BORDER).exists()).toBe(false);
    background.unmount();
  });
  it("shows no working border in the quick composer, which has no run state", () => {
    const wrapper = mountComposer({ isActive: true });
    expect(wrapper.find(WORKING_BORDER).exists()).toBe(false);
    wrapper.unmount();
  });
  it("shows no working border while Working glow is off in Appearance settings", async () => {
    window.localStorage.setItem(COMPOSER_GLOW_STORAGE_KEY, "false");
    const wrapper = mountComposer({ isRunning: true, isActive: true });
    try {
      expect(wrapper.find(WORKING_BORDER).exists()).toBe(false);

      useAppearanceStore().setComposerGlow(true);
      await nextTick();
      const border = wrapper.find(WORKING_BORDER);
      expect(border.exists()).toBe(true);
      expect(border.attributes("data-state")).toBe("on");

      // Off mid-run takes the normal exit.
      useAppearanceStore().setComposerGlow(false);
      await nextTick();
      expect(wrapper.get(WORKING_BORDER).attributes("data-state")).toBe(
        "leaving",
      );
    } finally {
      wrapper.unmount();
      window.localStorage.removeItem(COMPOSER_GLOW_STORAGE_KEY);
    }
  });
  it("unmounts the working border with the text box when an approval card replaces it", () => {
    const wrapper = mountComposer({
      isRunning: true,
      isActive: true,
      pendingApproval: {
        requestId: "working-border",
        toolCallId: "tool-1",
        toolName: "bash",
        trigger: "pre-execution",
      },
    });
    expect(wrapper.findComponent(ProjectApprovalCard).exists()).toBe(true);
    expect(wrapper.find(WORKING_BORDER).exists()).toBe(false);
    wrapper.unmount();
  });

  it("optimizes the prompt with Cmd+Enter, disabling the input in colour meanwhile", async () => {
    let resolve: (value: { prompt: string }) => void = () => undefined;
    const rewritePrompt = vi.fn(
      () =>
        new Promise<{ prompt: string }>((done) => {
          resolve = done;
        }),
    );
    const wrapper = mountComposer({ isActive: true }, "high", "zh-CN", {
      rewritePrompt,
    });
    const textarea = wrapper.get("textarea");
    await textarea.setValue("写个周报");

    await textarea.trigger("keydown", { key: "Enter", metaKey: true });

    expect(rewritePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "写个周报" }),
    );
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(textarea.attributes("disabled")).toBeDefined();
    expect(wrapper.get(WORKING_BORDER).attributes("data-variant")).toBe(
      "spectrum",
    );
    expect(
      wrapper.get('button[aria-label="发送消息"]').attributes("disabled"),
    ).toBeDefined();

    resolve({ prompt: "为 [[团队名称]] 写一份本周周报。" });
    await flushPromises();

    await flushPromises();
    const element = textarea.element as HTMLTextAreaElement;
    expect(element.value).toBe("为 [[团队名称]] 写一份本周周报。");
    expect(textarea.attributes("disabled")).toBeUndefined();
    expect(
      element.value.slice(element.selectionStart, element.selectionEnd),
    ).toBe("[[团队名称]]");
    wrapper.unmount();
  });

  it("ignores an optimized prompt that arrives after Escape", async () => {
    let resolve: (value: { prompt: string }) => void = () => undefined;
    const rewritePrompt = vi.fn(
      () =>
        new Promise<{ prompt: string }>((done) => {
          resolve = done;
        }),
    );
    const wrapper = mountComposer({ isActive: true }, "high", "zh-CN", {
      rewritePrompt,
    });
    const textarea = wrapper.get("textarea");
    await textarea.trigger("keydown", { key: "Enter", metaKey: true });
    expect(rewritePrompt).not.toHaveBeenCalled();
    await textarea.setValue("整理一下");

    await textarea.trigger("keydown", { key: "Enter", metaKey: true });
    expect(rewritePrompt).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    resolve({ prompt: "改写后的内容" });
    await flushPromises();

    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "整理一下",
    );
    expect(wrapper.get("textarea").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("does not optimize while the agent is running", async () => {
    const rewritePrompt = vi.fn();
    const wrapper = mountComposer({ isRunning: true }, "high", "zh-CN", {
      rewritePrompt,
    });
    const textarea = wrapper.get("textarea");
    await textarea.setValue("补充一点");

    await textarea.trigger("keydown", { key: "Enter", metaKey: true });

    expect(rewritePrompt).not.toHaveBeenCalled();
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("offers Optimize prompt in a new session's footer and beside Send in a session", async () => {
    const rewritePrompt = vi.fn(() => new Promise(() => undefined));
    const draft = mountComposer({}, "high", "zh-CN", { rewritePrompt });
    const trigger = draft
      .get('[data-slot="session-composer-footer"]')
      .get('[data-slot="optimize-prompt-trigger"]');
    expect(trigger.text()).toContain("优化指令");
    expect(trigger.attributes("disabled")).toBeDefined();

    await draft.get("textarea").setValue("写个周报");
    await trigger.trigger("click");
    expect(rewritePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "写个周报" }),
    );

    // A rewrite turns the button into Undo, which brings the text back.
    draft.unmount();
    let resolve: (value: { prompt: string }) => void = () => undefined;
    const undoable = mountComposer({}, "high", "zh-CN", {
      rewritePrompt: () =>
        new Promise<{ prompt: string }>((done) => {
          resolve = done;
        }),
    });
    await undoable.get("textarea").setValue("写个周报");
    await undoable
      .get('[data-slot="optimize-prompt-trigger"]')
      .trigger("click");
    resolve({ prompt: "为 [[团队名称]] 写周报。" });
    await flushPromises();
    await flushPromises();
    expect(
      undoable.find('[data-slot="optimize-prompt-trigger"]').exists(),
    ).toBe(false);
    await undoable
      .get('[data-slot="undo-prompt-optimization"]')
      .trigger("click");
    expect(
      (undoable.get("textarea").element as HTMLTextAreaElement).value,
    ).toBe("写个周报");
    expect(
      undoable.find('[data-slot="optimize-prompt-trigger"]').exists(),
    ).toBe(true);
    undoable.unmount();

    // In a session it sits beside Send instead, and hides while running.
    const session = mountComposer({ sessionId: "session-1" });
    expect(
      session
        .get('[data-slot="session-composer-footer"]')
        .find('[data-slot="optimize-prompt-trigger"]')
        .exists(),
    ).toBe(false);
    expect(
      session
        .get('.session-composer-row [data-align="inline-end"]')
        .find('[data-slot="optimize-prompt-trigger"]')
        .exists(),
    ).toBe(true);
    session.unmount();
    const running = mountComposer({ sessionId: "session-1", isRunning: true });
    expect(running.find('[data-slot="optimize-prompt-trigger"]').exists()).toBe(
      false,
    );
    running.unmount();
  });

  it("gives the rewriter the conversation, attachments and quotes as context", async () => {
    const rewritePrompt = vi.fn(() => new Promise(() => undefined));
    const wrapper = mountComposer(
      { sessionId: "session-1", isActive: true },
      "high",
      "zh-CN",
      { rewritePrompt },
    );
    const state = useSessionStore().stateFor("session-1");
    state.messages = [
      {
        id: "m1",
        createdAt: "2026-11-17T00:00:00.000Z",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "整理 docs 目录" }],
      },
      {
        id: "m2",
        createdAt: "2026-11-17T00:00:01.000Z",
        role: "assistant",
        status: "complete",
        blocks: [
          { type: "thinking", thinking: "内部推理" },
          { type: "text", text: "已整理，共 12 个文件。" },
        ],
      },
    ];
    await wrapper.setProps({
      quotes: [{ text: "共 12 个文件", role: "assistant" }],
      attachments: [
        {
          extension: "md",
          kind: "file",
          modifiedAt: "2026-11-17T00:00:00.000Z",
          name: "README.md",
          path: "/repo/README.md",
          size: 10,
        },
      ],
    });
    const textarea = wrapper.get("textarea");
    await textarea.setValue("把刚才那些再按日期排一下");

    await textarea.trigger("keydown", { key: "Enter", metaKey: true });

    expect(rewritePrompt).toHaveBeenCalledWith({
      prompt: "把刚才那些再按日期排一下",
      context: {
        conversation: [
          { role: "user", text: "整理 docs 目录" },
          { role: "assistant", text: "已整理，共 12 个文件。" },
        ],
        conversationTrimmed: false,
        attachments: [
          { name: "README.md", path: "/repo/README.md", kind: "file" },
        ],
        quotes: [{ text: "共 12 个文件" }],
      },
    });
    wrapper.unmount();
  });

  it("suggests a reply after the agent answers and fills it in with Tab", async () => {
    const suggestReply = vi
      .fn()
      .mockResolvedValue({ suggestion: "再按日期排序" });
    const wrapper = mountComposer(
      { sessionId: "session-1", isRunning: true, isActive: true },
      "high",
      "zh-CN",
      { suggestReply },
    );
    useSessionStore().stateFor("session-1").messages = [
      {
        id: "m1",
        createdAt: "2026-11-17T00:00:00.000Z",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "整理 docs 目录" }],
      },
      {
        id: "m2",
        createdAt: "2026-11-17T00:00:01.000Z",
        role: "assistant",
        status: "complete",
        blocks: [{ type: "text", text: "已整理。" }],
      },
    ];

    await wrapper.setProps({ isRunning: false });
    await flushPromises();

    expect(suggestReply).toHaveBeenCalledWith({
      context: {
        conversation: [
          { role: "user", text: "整理 docs 目录" },
          { role: "assistant", text: "已整理。" },
        ],
        conversationTrimmed: false,
      },
    });
    const suggestion = wrapper.get('[data-slot="reply-suggestion"]');
    expect(suggestion.text()).toContain("再按日期排序");
    expect(suggestion.text()).toContain("Tab");
    // A white keycap on the light composer surface, the default in dark.
    expect(
      suggestion.get('[data-slot="reply-suggestion-key"]').classes(),
    ).toEqual(
      expect.arrayContaining([
        "in-data-[slot=input-group]:bg-background",
        "ring-1",
        "dark:in-data-[slot=input-group]:bg-input",
        "dark:ring-0",
      ]),
    );
    const textarea = wrapper.get("textarea");
    expect(textarea.classes()).toContain("session-composer-input--suggesting");

    await textarea.trigger("keydown", { key: "Tab" });

    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "再按日期排序",
    );
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(false);

    // Filling it in uses it up: emptying the box leaves the placeholder.
    await textarea.setValue("");
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides the suggestion while typing or composing and drops it when a run starts", async () => {
    const wrapper = mountComposer(
      { sessionId: "session-1", isRunning: true },
      "high",
      "zh-CN",
      { suggestReply: vi.fn().mockResolvedValue({ suggestion: "继续" }) },
    );
    useSessionStore().stateFor("session-1").messages = [
      {
        id: "m1",
        createdAt: "2026-11-17T00:00:00.000Z",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "开始" }],
      },
    ];
    await wrapper.setProps({ isRunning: false });
    await flushPromises();
    const textarea = wrapper.get("textarea");

    // An input method composing text hides it before v-model sees any.
    await textarea.trigger("compositionstart");
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(false);
    await textarea.trigger("compositionend");
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(true);

    await textarea.setValue("自己写");
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(false);
    await textarea.trigger("keydown", { key: "Tab" });
    expect((textarea.element as HTMLTextAreaElement).value).toBe("自己写");

    await textarea.setValue("");
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(true);
    await wrapper.setProps({ isRunning: true });
    await wrapper.setProps({ isRunning: false, sessionId: "session-2" });
    await flushPromises();
    expect(wrapper.find('[data-slot="reply-suggestion"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("fades the suggestion in only over a visible placeholder", async () => {
    let resolveSuggestion: (value: { suggestion: string }) => void = () => {};
    const suggestReply = vi.fn(
      () =>
        new Promise<{ suggestion: string }>((resolve) => {
          resolveSuggestion = resolve;
        }),
    );
    const wrapper = mountComposer(
      { sessionId: "session-1", isRunning: true },
      "high",
      "zh-CN",
      { suggestReply },
    );
    useSessionStore().stateFor("session-1").messages = [
      {
        id: "m1",
        createdAt: "2026-11-17T00:00:00.000Z",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "开始" }],
      },
    ];
    const textarea = wrapper.get("textarea");
    const suggestion = () => wrapper.find('[data-slot="reply-suggestion"]');
    const fades = "session-composer-input--suggestion-fades";

    // Arriving over the placeholder: the placeholder fades out first.
    await wrapper.setProps({ isRunning: false });
    resolveSuggestion({ suggestion: "继续" });
    await flushPromises();
    expect(suggestion().exists()).toBe(true);
    expect(textarea.classes()).toContain(fades);

    // Typing, then emptying the box (delete, cut, undo): it comes back at
    // once, with the placeholder already transparent.
    await textarea.setValue("自");
    expect(suggestion().exists()).toBe(false);
    expect(textarea.classes()).not.toContain(fades);
    await textarea.setValue("");
    expect(suggestion().exists()).toBe(true);
    expect(textarea.classes()).toContain("session-composer-input--suggesting");
    expect(textarea.classes()).not.toContain(fades);

    // An input method composing and then cancelling behaves the same.
    await textarea.trigger("compositionstart");
    expect(suggestion().exists()).toBe(false);
    await textarea.trigger("compositionend");
    expect(suggestion().exists()).toBe(true);
    expect(textarea.classes()).not.toContain(fades);

    // Arriving while the user is typing: no placeholder to fade from.
    await wrapper.setProps({ isRunning: true });
    await wrapper.setProps({ isRunning: false });
    await textarea.setValue("草稿");
    resolveSuggestion({ suggestion: "再来" });
    await flushPromises();
    await textarea.setValue("");
    expect(suggestion().text()).toContain("再来");
    expect(textarea.classes()).not.toContain(fades);
    wrapper.unmount();
  });

  it("does not ask for a suggestion while reply suggestions are off", async () => {
    const suggestReply = vi.fn().mockResolvedValue({ suggestion: "继续" });
    const wrapper = mountComposer(
      { sessionId: "session-1", isRunning: true },
      "high",
      "zh-CN",
      { suggestReply },
    );
    useAppearanceStore().setReplySuggestions(false);
    useSessionStore().stateFor("session-1").messages = [
      {
        id: "m1",
        createdAt: "2026-11-17T00:00:00.000Z",
        role: "user",
        status: "complete",
        blocks: [{ type: "text", text: "开始" }],
      },
    ];
    await wrapper.setProps({ isRunning: false });
    await flushPromises();
    expect(suggestReply).not.toHaveBeenCalled();
    useAppearanceStore().setReplySuggestions(true);
    wrapper.unmount();
  });
});
