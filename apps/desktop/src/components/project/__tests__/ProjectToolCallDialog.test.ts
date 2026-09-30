import { flushPromises, mount } from "@vue/test-utils";
import {
  AlertCircleIcon,
  GlobeIcon,
  SearchIcon,
  ShieldBanIcon,
} from "@lucide/vue";
import { describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

function mountMarker(decidedBy: "judge" | "user" | "sandbox" | null = "judge") {
  return mount(ProjectToolCallMarker, {
    attachTo: document.body,
    props: {
      toolCall: {
        id: "call-bash-1",
        name: "bash",
        status: "error",
        approval: decidedBy
          ? {
              state: "denied",
              decidedBy,
              reason: "请改用不会覆盖现有文件的命令。",
            }
          : undefined,
        input: {
          command: "dangerous-command",
          description: "覆盖现有文件",
        },
        output: [
          {
            type: "text",
            text: "First paragraph\n\nSecond paragraph",
          },
        ],
        durationMs: 1_250,
      },
    },
    global: {
      plugins: [createAppI18n("zh-CN")],
    },
  });
}

describe("ProjectToolCallDialog", () => {
  it.each([
    ["read", "src/main.ts", undefined],
    ["write", "src/main.ts", undefined],
    [
      "ui_present_file",
      "/work/pine/src/main.ts",
      { details: { path: "/work/pine/src/main.ts" } },
    ],
  ] as const)(
    "opens a completed %s in Pine",
    async (name, expectedPath, output) => {
      const openFile = vi.fn(() => true);
      const wrapper = mount(ProjectToolCallMarker, {
        attachTo: document.body,
        props: {
          toolCall: {
            id: `${name}-1`,
            name,
            status: "complete",
            input: { path: "src/main.ts" },
            output,
          },
          openFile,
        },
        global: { plugins: [createAppI18n("zh-CN")] },
      });
      await wrapper.get('button[data-slot="marker"]').trigger("click");
      expect(openFile).toHaveBeenCalledWith(
        expectedPath,
        expect.objectContaining({ id: `${name}-1`, name }),
      );
      expect(
        document.body.querySelector('[data-slot="dialog-content"]'),
      ).toBeNull();
      wrapper.unmount();
    },
  );

  it("does not replace a missing presented file with a details dialog", async () => {
    const openFile = vi.fn().mockResolvedValue(false);
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "old-present-call",
          name: "ui_present_file",
          status: "complete",
          input: { path: "/Pine/projects/project/tmp/tool_probe.txt" },
        },
        openFile,
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await wrapper.get('button[data-slot="marker"]').trigger("click");
    await flushPromises();
    expect(openFile).toHaveBeenCalledOnce();
    expect(
      document.body.querySelector('[data-slot="dialog-content"]'),
    ).toBeNull();
    wrapper.unmount();
  });

  it("shows search results in a result table", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "search-1",
          name: "web_search",
          status: "complete",
          input: { query: "Pine", domain_type: "news" },
          output: {
            content: [
              {
                type: "text",
                text: '<tinyfish_web_data>\n{"results":[{"title":"First","url":"https://example.com/1","snippet":"One"},{"title":"Second","url":"https://example.com/2","snippet":"Two"}]}\n</tinyfish_web_data>',
              },
            ],
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await wrapper.get('button[data-slot="marker"]').trigger("click");
    expect(
      document.body.querySelectorAll("[data-web-results] tbody tr"),
    ).toHaveLength(2);
    expect(document.body.textContent).toContain("Second");
    wrapper.unmount();
  });

  it("renders edit replacements as a Shiki diff block", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "edit-1",
          name: "edit",
          status: "complete",
          input: {
            path: "src/main.ts",
            edits: [
              { oldText: "const value = 1;", newText: "const value = 2;" },
            ],
          },
        },
      },
      global: { plugins: [createPinia(), createAppI18n("zh-CN")] },
    });
    await wrapper.get('button[data-slot="marker"]').trigger("click");
    const code = document.body.querySelector('[data-slot="code-block"]');
    expect(code?.textContent).toContain("-const value = 1;");
    expect(code?.textContent).toContain("+const value = 2;");
    wrapper.unmount();
  });

  it("renders shell output as text and questionnaire answers by question", async () => {
    const shell = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "bash-2",
          name: "bash",
          status: "complete",
          input: { command: "pwd" },
          output: { content: [{ type: "text", text: "/work/pine\n" }] },
        },
      },
      global: { plugins: [createPinia(), createAppI18n("zh-CN")] },
    });
    await shell.get('button[data-slot="marker"]').trigger("click");
    expect(
      document.body.querySelector('[data-slot="code-block"]')?.textContent,
    ).toContain("pwd");
    expect(document.body.textContent).toContain("/work/pine");
    shell.unmount();

    const question = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "question-1",
          name: "ask_user_question",
          status: "complete",
          input: {
            questions: [
              {
                question: "Which format?",
                options: [{ label: "PDF" }, { label: "DOCX" }],
              },
            ],
          },
          output: {
            details: {
              answers: [{ question: "Which format?", answer: "PDF" }],
              cancelled: false,
            },
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await question.get('button[data-slot="marker"]').trigger("click");
    expect(document.body.textContent).toContain("Which format?");
    expect(document.body.textContent).toContain("PDF");
    expect(
      document.body.querySelectorAll('[data-slot="dialog-content"] ol li'),
    ).toHaveLength(2);
    expect(
      document.body.querySelectorAll(
        '[data-slot="dialog-content"] [data-slot="badge"]',
      ),
    ).toHaveLength(1);
    expect(
      document.body
        .querySelector('[data-slot="dialog-content"]')
        ?.classList.contains("w-fit"),
    ).toBe(true);
    question.unmount();
  });

  it("shows generated files and computer-use images without raw data tables", async () => {
    const media = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "image-1",
          name: "generate_image",
          status: "complete",
          input: {
            prompt: "Pine tree",
            input_references: ["data:image/png;base64,aGVsbG8="],
          },
          output: {
            details: {
              files: [{ path: "/work/pine/tree.png", mimeType: "image/png" }],
              model: "image-model",
            },
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await media.get('button[data-slot="marker"]').trigger("click");
    expect(document.body.textContent).toContain("/work/pine/tree.png");
    expect(document.body.textContent).toContain("Pine tree");
    expect(document.body.textContent).toContain("内嵌图片");
    expect(document.body.textContent).not.toContain("aGVsbG8=");
    media.unmount();

    const computer = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "screenshot-1",
          name: "screenshot",
          status: "complete",
          input: {},
          output: {
            content: [
              { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
            ],
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await computer.get('button[data-slot="marker"]').trigger("click");
    expect(
      document.body
        .querySelector('[data-slot="dialog-content"] img')
        ?.getAttribute("src"),
    ).toBe("data:image/png;base64,aGVsbG8=");
    expect(document.body.querySelector("[data-tool-value-table]")).toBeNull();
    computer.unmount();
  });

  it("shows fetched page text and Skill resources by their structure", async () => {
    const fetch = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "fetch-1",
          name: "web_fetch",
          status: "complete",
          input: { urls: ["https://example.com"] },
          output: {
            content: [
              {
                type: "text",
                text: '<tinyfish_web_data>{"results":[{"title":"Example","url":"https://example.com","text":"Page body"}]}</tinyfish_web_data>',
              },
            ],
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await fetch.get('button[data-slot="marker"]').trigger("click");
    expect(
      document.body.querySelector("[data-web-results] pre")?.textContent,
    ).toBe("Page body");
    fetch.unmount();

    const skill = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "skill-1",
          name: "list_skill_resources",
          status: "complete",
          input: { name: "example" },
          output: {
            details: {
              resources: [
                { path: "references/guide.md", kind: "file", size: 120 },
              ],
            },
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await skill.get('button[data-slot="marker"]').trigger("click");
    expect(document.body.textContent).toContain("references/guide.md");
    expect(document.body.textContent).toContain("120 B");
    skill.unmount();
  });

  it.each(["judge", "user"] as const)(
    "distinguishes %s denials from execution failures",
    async (decidedBy) => {
      const wrapper = mountMarker(decidedBy);
      expect(wrapper.findComponent(ShieldBanIcon).exists()).toBe(true);
      expect(wrapper.findComponent(AlertCircleIcon).exists()).toBe(false);
      expect(wrapper.text()).toContain("已拒绝");
      await wrapper.setProps({
        reviewing: true,
        toolCall: { ...wrapper.props("toolCall"), status: "running" },
      });
      expect(wrapper.text()).toContain("已拒绝");
      expect(wrapper.text()).not.toContain("正在审核");
      await wrapper.get('button[data-slot="marker"]').trigger("click");
      const badges = document.body.querySelectorAll(
        '[data-slot="dialog-content"] [data-slot="badge"]',
      );
      expect(badges).toHaveLength(2);
      expect(document.body.textContent).toContain(
        decidedBy === "judge" ? "自动审批驳回" : "用户已拒绝",
      );
      wrapper.unmount();
    },
  );

  it("labels sandbox denials as sandbox-rejected warnings", async () => {
    const wrapper = mountMarker("sandbox");
    expect(wrapper.findComponent(ShieldBanIcon).exists()).toBe(true);
    expect(wrapper.findComponent(AlertCircleIcon).exists()).toBe(false);
    await wrapper.get('button[data-slot="marker"]').trigger("click");
    expect(document.body.textContent).toContain("沙箱拒绝");
    wrapper.unmount();
  });

  it("keeps execution failures destructive", async () => {
    const wrapper = mountMarker(null);
    expect(wrapper.findComponent(AlertCircleIcon).exists()).toBe(true);
    expect(wrapper.findComponent(ShieldBanIcon).exists()).toBe(false);
    await wrapper.get('button[data-slot="marker"]').trigger("click");
    wrapper.unmount();
  });

  it("shows status, parameters, result, and auto-review rejection reason", async () => {
    const wrapper = mountMarker();
    await wrapper.get('button[data-slot="marker"]').trigger("click");

    const dialogText = document.body.textContent ?? "";
    expect(dialogText).toContain("工具调用详情");
    expect(dialogText).toContain("自动审批驳回");
    expect(dialogText).toContain("请改用不会覆盖现有文件的命令。");
    const tables = document.body.querySelectorAll("[data-tool-value-table]");
    expect(tables).toHaveLength(1);
    expect(dialogText).toContain("dangerous-command");
    expect(dialogText).not.toContain("[0].type");
    expect(dialogText).not.toContain("[0].text");
    expect(dialogText).toContain("First paragraph\n\nSecond paragraph");
    expect(dialogText).not.toContain("\\n\\n");
    expect(dialogText).toContain("1.3 秒");
    wrapper.unmount();
  });

  it("shows a live line count for an in-progress write", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "call-write-1",
          name: "write",
          status: "running",
          input: {
            path: "src/main.ts",
            content: "line1\nline2\nline3",
          },
        },
      },
      global: {
        plugins: [createAppI18n("zh-CN")],
      },
    });
    const count = wrapper.get("[data-write-lines]");
    expect(count.text()).toBe("（3 行）");
    expect(count.classes()).toContain("text-sm");
    expect(count.classes()).not.toContain("text-xs");
    // The content argument grows as the model streams it.
    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        input: {
          path: "src/main.ts",
          content: "line1\nline2\nline3\nline4",
        },
      },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.get("[data-write-lines]").text()).toBe("（4 行）");
    wrapper.unmount();
  });

  it("shows TinyFish search parameters with a search icon", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "call-web-search-1",
          name: "web_search",
          status: "running",
          input: {
            query: "latest Pine release",
            purpose: "用于补充页面信息",
            domain_type: "news",
            recency_minutes: 1_501,
            include_domains: ["example.com", "docs.example.com"],
            page: 2,
          },
        },
      },
      global: {
        plugins: [createAppI18n("zh-CN")],
      },
    });

    expect(wrapper.findComponent(SearchIcon).exists()).toBe(true);
    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toContain("正在搜索");
    expect(content.text()).toContain(
      "近 1 天 1 小时 1 分钟 latest Pine release 的新闻",
    );
    const purpose = wrapper.get("[data-tool-purpose]");
    expect(purpose.text()).toBe("用于补充页面信息");
    expect(purpose.classes()).toContain("font-semibold");
    expect(content.text()).toContain("站点 example.com");
    expect(content.text()).toContain("另 1 个站点");
    expect(content.text()).toContain("第 2 页");
    wrapper.unmount();
  });

  it("shows TinyFish fetch parameters with a globe icon", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "call-web-fetch-1",
          name: "web_fetch",
          status: "running",
          input: {
            urls: ["https://example.com/docs", "https://example.com/faq"],
            purpose: "查看苹果官网首页展示的最新产品信息",
            highlights: {
              query: "pricing and limits",
            },
          },
        },
      },
      global: {
        plugins: [createAppI18n("zh-CN")],
      },
    });

    expect(wrapper.findComponent(GlobeIcon).exists()).toBe(true);
    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toContain("正在抓取");
    expect(content.text()).toContain("https://example.com/docs");
    expect(content.text()).toContain("以及另 1 个网页");
    expect(content.text()).not.toContain("格式");
    expect(content.text()).toContain("重点：pricing and limits");
    const purpose = wrapper.get("[data-tool-purpose]");
    expect(purpose.text()).toBe("查看苹果官网首页展示的最新产品信息");
    expect(purpose.classes()).toContain("font-semibold");
    wrapper.unmount();
  });

  it("uses the returned page title and favicon after a fetch completes", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "call-web-fetch-title-1",
          name: "web_fetch",
          status: "complete",
          input: {
            urls: [
              "https://deploymentsafety.openai.com/gpt-6-astra",
              "https://example.com",
            ],
            purpose: "查看 GPT-6 Astra 页面信息",
          },
          output: {
            details: {
              pageTitle:
                "GPT-6 Astra System Card - OpenAI Deployment Safety Hub",
              faviconDataUrl: "data:image/png;base64,iVBORw==",
            },
          },
        },
      },
      global: {
        plugins: [createAppI18n("zh-CN")],
      },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toContain("GPT-6 Astra System Card…");
    expect(content.text()).not.toContain(
      "https://deploymentsafety.openai.com/gpt-6-astra",
    );
    expect(content.text()).toContain("以及另 1 个网页");
    expect(wrapper.get("[data-tool-favicon]").attributes("src")).toBe(
      "data:image/png;base64,iVBORw==",
    );
    wrapper.unmount();
  });

  it("extracts a title from the TinyFish envelope when details are absent", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      attachTo: document.body,
      props: {
        toolCall: {
          id: "call-web-fetch-envelope-1",
          name: "web_fetch",
          status: "complete",
          input: {
            urls: ["https://deploymentsafety.openai.com/gpt-6-astra"],
          },
          output: {
            content: [
              {
                type: "text",
                text: `<tinyfish_web_data>\n{
  "results": [
    {
      "url": "[https://deploymentsafety.openai.com/gpt-6-astra](https://deploymentsafety.openai.com/gpt-6-astra)",
      "title": "GPT-6 Astra System Card - OpenAI Deployment Safety Hub",
`,
              },
            ],
          },
        },
      },
      global: {
        plugins: [createAppI18n("zh-CN")],
      },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toContain("GPT-6 Astra System Card…");
    expect(content.text()).not.toContain("https://deploymentsafety.openai.com");
    wrapper.unmount();
  });
});
