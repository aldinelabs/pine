import { mount } from "@vue/test-utils";
import {
  BookOpenIcon,
  CircleHelpIcon,
  EyeIcon,
  MonitorCogIcon,
  PanelTopIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "@lucide/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createAppI18n } from "@/app/i18n";
import * as animateScroll from "@/lib/animateScroll";
import { createPinia } from "pinia";
import ProjectCompactionMarker from "../ProjectCompactionMarker.vue";
import ProjectThinkingMarker from "../ProjectThinkingMarker.vue";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

describe("project transcript markers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shimmers while compacting and settles after compaction", async () => {
    const wrapper = mount(ProjectCompactionMarker, {
      props: {
        compaction: { id: "compaction-1", status: "running" },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "正在压缩上下文",
    );
    expect(wrapper.get('[data-slot="marker-content"]').classes()).toContain(
      "shimmer",
    );
    expect(wrapper.get('[data-slot="marker"]').attributes("aria-live")).toBe(
      "polite",
    );

    await wrapper.setProps({
      compaction: { id: "compaction-1", status: "complete" },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "已压缩上下文",
    );
    expect(wrapper.get('[data-slot="marker-content"]').classes()).not.toContain(
      "shimmer",
    );
    expect(wrapper.get('[data-slot="marker"]').attributes("aria-live")).toBe(
      undefined,
    );
  });

  it("shows a stable elapsed-time summary and expands streaming thinking", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [{ type: "thinking", thinking: "Inspect the request." }],
          thinkingStartedAt: 1_000,
          thinkingStatus: "streaming",
        },
      },
      global: {
        plugins: [createPinia(), createAppI18n("en-US")],
      },
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.text()).toContain("Thinking (1s)");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".shimmer").exists()).toBe(false);

    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("[data-thinking-content]").text()).toBe(
      "Inspect the request.",
    );

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          {
            type: "thinking",
            thinking: "Inspect the request.\nCheck the active session.",
          },
        ],
      },
    });
    expect(wrapper.get("[data-thinking-content]").text()).toContain(
      "Check the active session.",
    );

    vi.setSystemTime(3_250);
    await vi.advanceTimersByTimeAsync(250);
    expect(trigger.text()).toContain("Thinking (2.5s)");
    wrapper.unmount();
  });

  it("auto-collapses when assistant output begins after thinking", async () => {
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [{ type: "thinking", thinking: "Inspect the request." }],
          thinkingStartedAt: Date.now(),
          thinkingStatus: "streaming",
        },
      },
      global: {
        plugins: [createPinia(), createAppI18n("en-US")],
      },
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.attributes("aria-expanded")).toBe("true");

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        thinkingStatus: "complete",
      },
    });
    expect(trigger.attributes("aria-expanded")).toBe("true");

    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          { type: "thinking", thinking: "Inspect the request." },
          { type: "text", text: "Here is the result." },
        ],
      },
    });
    expect(trigger.attributes("aria-expanded")).toBe("false");
  });

  it("summarizes completed thinking and keeps the full content expandable", async () => {
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [
            {
              type: "thinking",
              thinking: "Inspect the request.\nCheck the active session.",
            },
            { type: "text", text: "Working on it" },
          ],
          thinkingDurationMs: 2_500,
          thinkingStatus: "complete",
        },
      },
      global: {
        plugins: [createPinia(), createAppI18n("zh-CN")],
      },
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.text()).toContain("已工作 2.5 秒");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("[data-thinking-content]").text()).toContain(
      "Inspect the request.",
    );
  });

  it("keeps following thinking during programmatic internal scroll animation", async () => {
    const animateSpy = vi
      .spyOn(animateScroll, "animateScrollTop")
      .mockImplementation((element, top) => {
        element.scrollTop = Math.max(0, top - 40);
        element.dispatchEvent(new Event("scroll"));
        return () => undefined;
      });
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [{ type: "thinking", thinking: "Inspect the request." }],
          thinkingStartedAt: Date.now(),
          thinkingStatus: "streaming",
        },
      },
      global: {
        plugins: [createPinia(), createAppI18n("en-US")],
      },
    });

    const content = wrapper.get("[data-thinking-content]")
      .element as HTMLElement;
    await nextTick();
    let thinkingScrollHeight = 600;
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      get: () => thinkingScrollHeight,
    });
    content.scrollTop = 500;
    animateSpy.mockClear();

    thinkingScrollHeight = 700;
    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          {
            type: "thinking",
            thinking: "Inspect the request.\nCheck one more state.",
          },
        ],
      },
    });
    await nextTick();

    thinkingScrollHeight = 800;
    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          {
            type: "thinking",
            thinking:
              "Inspect the request.\nCheck one more state.\nThen continue streaming.",
          },
        ],
      },
    });
    await nextTick();

    expect(animateSpy).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    animateSpy.mockRestore();
  });

  it("stops following thinking only after explicit user scroll intent", async () => {
    const animateSpy = vi
      .spyOn(animateScroll, "animateScrollTop")
      .mockImplementation((element, top) => {
        element.scrollTop = top;
        return () => undefined;
      });
    const wrapper = mount(ProjectThinkingMarker, {
      props: {
        message: {
          createdAt: "2026-08-26T00:00:00.000Z",
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          blocks: [{ type: "thinking", thinking: "Inspect the request." }],
          thinkingStartedAt: Date.now(),
          thinkingStatus: "streaming",
        },
      },
      global: {
        plugins: [createPinia(), createAppI18n("en-US")],
      },
    });

    const content = wrapper.get("[data-thinking-content]")
      .element as HTMLElement;
    await nextTick();
    let thinkingScrollHeight = 600;
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      get: () => thinkingScrollHeight,
    });
    content.scrollTop = 500;
    animateSpy.mockClear();

    content.dispatchEvent(new Event("wheel"));
    content.scrollTop = 300;
    content.dispatchEvent(new Event("scroll"));
    thinkingScrollHeight = 700;
    await wrapper.setProps({
      message: {
        ...wrapper.props("message"),
        blocks: [
          {
            type: "thinking",
            thinking: "Inspect the request.\nThe user is reading above.",
          },
        ],
      },
    });
    await nextTick();

    expect(animateSpy).not.toHaveBeenCalled();
    wrapper.unmount();
    animateSpy.mockRestore();
  });

  it("uses semantic labels for primary tools and truncates commands", () => {
    const command = `bun run ${"very-long-argument ".repeat(8)}`;
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: { command },
          name: "bash",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toMatch(/^正在执行 bun run/);
    expect(content.text()).toContain("…");
    expect(content.text().length).toBeLessThan(command.length);
    expect(wrapper.get('[data-slot="marker"]').attributes("aria-live")).toBe(
      "polite",
    );
  });

  it("formats Computer Use calls without exposing typed text", () => {
    const desktop = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "computer-1",
          input: { element_id: "e12", text: "private draft text" },
          name: "type_text",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(desktop.text()).toContain("Typing text");
    expect(desktop.text()).toContain("Typing text e12");
    expect(desktop.text()).toContain("e12");
    expect(desktop.text()).not.toContain("private draft text");
    expect(desktop.get("code").text()).toBe("e12");
    expect(desktop.findComponent(MonitorCogIcon).exists()).toBe(true);

    const browser = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "browser-1",
          input: { tab_id: 7 },
          name: "browser_snapshot",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(browser.text()).toContain("Viewed webpage tab 7");
    expect(browser.text()).toContain("tab 7");
    expect(browser.find("code").exists()).toBe(false);
    expect(browser.findComponent(PanelTopIcon).exists()).toBe(true);

    const chinese = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "computer-zh",
          input: {},
          name: "list_apps",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(chinese.text()).toContain("已查看已打开的应用");
    expect(chinese.text()).not.toContain("project.transcript");

    const appState = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "state-zh",
          // Historical assistant messages may keep tool arguments as JSON.
          input: JSON.stringify({ app: "System Settings" }),
          name: "get_app_state",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(appState.text()).toContain("已查看 System Settings 应用状态");

    const screenshot = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "screenshot-zh",
          input: { app: "System Settings" },
          name: "screenshot",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(screenshot.text()).toContain("已给 System Settings 截图并查看");

    const parsedTarget = mount(ProjectToolCallMarker, {
      props: {
        contextToolCalls: [
          {
            id: "state-1",
            name: "get_app_state",
            input: { app: "System Settings" },
            output: {
              content: [{ type: "text", text: '[e133] Button "Show Detail"' }],
            },
            status: "complete",
          },
        ],
        toolCall: {
          id: "click-1",
          input: { element_id: "e133" },
          name: "click",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(parsedTarget.text()).toContain(
      '已点击界面上的 Button "Show Detail"',
    );
    expect(parsedTarget.text()).not.toContain("e133");
    expect(parsedTarget.find("code").exists()).toBe(false);
  });

  it("uses no-parameter variants when Computer Use values are absent", () => {
    const cases = [
      {
        locale: "en-US" as const,
        name: "get_app_state",
        input: {},
        expected: "Viewed app state",
      },
      {
        locale: "en-US" as const,
        name: "click",
        input: { click_count: 2 },
        expected: "Clicked the interface",
      },
      {
        locale: "en-US" as const,
        name: "activate_app",
        input: {},
        expected: "Switched to an app",
      },
      {
        locale: "zh-CN" as const,
        name: "screenshot",
        input: { display: 1 },
        expected: "已截取屏幕并查看",
      },
      {
        locale: "zh-CN" as const,
        name: "browser_snapshot",
        input: {},
        expected: "已查看网页",
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const wrapper = mount(ProjectToolCallMarker, {
        props: {
          toolCall: {
            id: `computer-without-parameter-${index}`,
            input: testCase.input,
            name: testCase.name,
            status: "complete",
          },
        },
        global: { plugins: [createAppI18n(testCase.locale)] },
      });

      expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
        testCase.expected,
      );
      wrapper.unmount();
    }
  });

  it("renders questionnaire tool progress without exposing its raw name", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-questionnaire",
          input: { questions: [{ question: "Choose an approach" }] },
          name: "ask_user_question",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe("正在准备询问一些问题");
    expect(content.find("code").exists()).toBe(false);
    expect(wrapper.findComponent(CircleHelpIcon).exists()).toBe(true);

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        status: "complete",
        output: {
          details: {
            answers: [{ questionIndex: 0 }, { questionIndex: 1 }],
            cancelled: false,
          },
        },
      },
    });

    expect(content.text()).toBe("已获得 2 个问题的答案");
    expect(content.classes()).not.toContain("shimmer");
  });

  it("renders Skill operations with dedicated copy, targets, and icons", () => {
    const cases = [
      {
        name: "activate_skill_authoring",
        input: {},
        expected: "已启用技能创作",
        icon: WandSparklesIcon,
      },
      {
        name: "invoke_skill",
        input: { name: "release-notes" },
        expected: "已调用工作技能 release-notes",
        icon: BookOpenIcon,
      },
      {
        name: "create_skill",
        input: { name: "release-notes", scope: "global" },
        expected: "已创建全局工作技能 release-notes",
        icon: PlusIcon,
      },
      {
        name: "edit_skill",
        input: { name: "release-notes", scope: "project" },
        expected: "已编辑项目工作技能 release-notes",
        icon: SquarePenIcon,
      },
      {
        name: "remove_skill",
        input: { name: "release-notes", scope: "project" },
        expected: "已删除项目工作技能 release-notes",
        icon: Trash2Icon,
      },
    ] as const;

    for (const testCase of cases) {
      const wrapper = mount(ProjectToolCallMarker, {
        props: {
          toolCall: {
            id: `skill-${testCase.name}`,
            input: testCase.input,
            name: testCase.name,
            status: "complete",
          },
        },
        global: { plugins: [createAppI18n("zh-CN")] },
      });

      const content = wrapper.get('[data-slot="marker-content"]');
      expect(content.text()).toBe(testCase.expected);
      expect(wrapper.findComponent(testCase.icon).exists()).toBe(true);
      expect(content.text()).not.toContain(testCase.name);
      wrapper.unmount();
    }
  });

  it("shows the presented filename instead of the raw tool name", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-present",
          input: { path: "/Users/kw/project/reports/quarterly.md" },
          name: "ui_present_file",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe("正在打开 quarterly.md");
    expect(content.find("code").text()).toBe("quarterly.md");
    expect(content.text()).not.toContain("ui_present_file");
    expect(wrapper.findComponent(EyeIcon).exists()).toBe(true);

    await wrapper.setProps({
      toolCall: { ...wrapper.props("toolCall"), status: "complete" },
    });
    expect(content.text()).toBe("已打开 quarterly.md");
  });

  it("shows the filename when a read completes", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: { path: "/Users/kw/project/src/main.ts" },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "已读取 main.ts",
    );

    const code = wrapper.get('[data-slot="marker-content"] code');
    expect(code.text()).toBe("main.ts");
  });

  it("shows a bash operation summary before the command", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: {
            command: "bun run typecheck",
            description: "Checks types across the app",
          },
          name: "bash",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe(
      "已执行 Checks types across the app：bun run typecheck",
    );
    expect(content.get("code").text()).toBe("bun run typecheck");
  });

  it("renders privileged bash with the same command UI as ordinary bash", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-privileged",
          input: {
            command: "osascript -e 'tell application \"Music\" to play'",
            description: "Play music with the Music app",
          },
          name: "privileged_bash",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe(
      "已执行 Play music with the Music app：osascript -e 'tell application \"Music\" to play'",
    );
    expect(content.get("code").text()).toContain("osascript");
    expect(wrapper.get("svg").attributes("class")).toContain("terminal");
  });

  it("renders read line ranges and edit line tallies semantically", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: {
            path: "/project/src/main.ts",
            offset: 12,
            limit: 20,
          },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(wrapper.get('[data-slot="marker-content"] code').text()).toBe(
      "main.ts:12-31",
    );

    const offsetOnly = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-offset-only",
          input: {
            path: "/project/src/background.js",
            offset: 1513,
          },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(offsetOnly.get('[data-slot="marker-content"] code').text()).toBe(
      "background.js:1513",
    );
    expect(
      offsetOnly.get('[data-slot="marker-content"] code').text(),
    ).not.toContain("1513-");

    const editor = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-2",
          input: {
            path: "/project/src/main.ts",
            edits: [
              { oldText: "a\nb\nc", newText: "1\n2\n3\n4\n5" },
              { oldText: "d\ne", newText: "6" },
              {},
            ],
          },
          name: "edit",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    const added = editor
      .get('[data-slot="marker-content"]')
      .findAll("span")
      .find((node) => node.text() === "+6");
    expect(added).toBeDefined();
    expect(editor.get('[data-slot="marker-content"]').text()).toContain("-5");

    // No range when a whole file was read.
    const whole = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-3",
          input: { path: "/project/src/main.ts" },
          name: "read",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(whole.get('[data-slot="marker-content"] code').text()).toBe(
      "main.ts",
    );
  });

  it("falls back to the command when a bash call has no description", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-1",
          input: { command: "bun run typecheck" },
          name: "bash",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
      "已执行 bun run typecheck",
    );
  });
});
