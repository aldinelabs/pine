import { mount } from "@vue/test-utils";
import {
  AppWindowIcon,
  BookOpenIcon,
  CircleHelpIcon,
  EyeIcon,
  ListTodoIcon,
  MonitorCogIcon,
  PackageCheckIcon,
  PanelTopIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
  WandSparklesIcon,
  HistoryIcon,
} from "@lucide/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createAppI18n } from "@/app/i18n";
import * as animateScroll from "@/lib/animateScroll";
import { createPinia } from "pinia";
import { resizeObserverStub } from "@/__tests__/perf/streamHarness";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import ProjectCompactionMarker from "../ProjectCompactionMarker.vue";
import ProjectThinkingMarker from "../ProjectThinkingMarker.vue";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

describe("project transcript markers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { name: "mcp__example__run", input: { tool: "run", server: "example" } },
    { name: "mcp_config_save", input: { name: "example", config: {} } },
    { name: "ui_present_file", input: { path: "report.md" } },
    { name: "find", input: { pattern: "*.vue" } },
  ])(
    "preserves monospace targets through review and approval for $name",
    async ({ name, input }) => {
      const wrapper = mount(ProjectToolCallMarker, {
        props: {
          toolCall: { id: "review-font", name, input, status: "running" },
        },
        global: { plugins: [createAppI18n("en-US")] },
      });
      expect(wrapper.get("code").classes()).toContain("font-mono");
      await wrapper.setProps({ reviewing: true });
      expect(wrapper.get("code").classes()).toContain("font-mono");
      expect(wrapper.get('[data-slot="marker-content"]').classes()).toContain(
        "shimmer-color-info",
      );
      await wrapper.setProps({ reviewing: false, awaitingApproval: true });
      expect(wrapper.get("code").classes()).toContain("font-mono");
      wrapper.unmount();
    },
  );

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

  interface FakeGlide {
    currentTime: number | null;
    playState: AnimationPlayState;
    cancel: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
  }

  /**
   * A streaming marker whose panel reports a stubbed layout and resize
   * notifications, as the browser does after each content update. The body
   * records its compositor glides.
   */
  function mountFollowingThinking() {
    const observers = resizeObserverStub();
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
    const body = content.firstElementChild as HTMLElement;
    let bodyHeight = 600;
    let scrollTop = 0;
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(content, "scrollHeight", {
      configurable: true,
      get: () => bodyHeight,
    });
    Object.defineProperty(body, "offsetHeight", {
      configurable: true,
      get: () => bodyHeight,
    });
    Object.defineProperty(content, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      scrollTop = top ?? scrollTop;
    });
    Object.defineProperty(content, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    const glides: FakeGlide[] = [];
    const animate = vi.fn<
      (keyframes: Keyframe[], options: KeyframeAnimationOptions) => FakeGlide
    >((): FakeGlide => {
      const glide: FakeGlide = {
        currentTime: 0,
        playState: "running",
        cancel: vi.fn(),
        addEventListener: vi.fn(),
      };
      glides.push(glide);
      return glide;
    });
    Object.defineProperty(body, "animate", {
      configurable: true,
      value: animate,
    });
    async function grow(height: number, thinking: string): Promise<void> {
      bodyHeight = height;
      await wrapper.setProps({
        message: {
          ...wrapper.props("message"),
          blocks: [{ type: "thinking", thinking }],
        },
      });
      observers.fire((target) => content.contains(target));
      await nextTick();
    }
    function cleanup(): void {
      wrapper.unmount();
      observers.restore();
    }
    return {
      wrapper,
      content,
      body,
      grow,
      scrollTo,
      animate,
      glides,
      cleanup,
      finish: () =>
        wrapper.setProps({
          message: { ...wrapper.props("message"), thinkingStatus: "complete" },
        }),
    };
  }

  const glideStart = (call: unknown[]) =>
    ((call[0] as Keyframe[])[0] as { transform: string }).transform;

  it("follows streaming thinking with a compositor glide instead of a tween", async () => {
    const animateSpy = vi
      .spyOn(animateScroll, "animateScrollTop")
      .mockImplementation(() => () => undefined);
    const frameSpy = vi.spyOn(window, "requestAnimationFrame");
    const marker = mountFollowingThinking();
    await nextTick();
    marker.content.scrollTop = 500;

    await marker.grow(700, "Inspect the request.\nCheck one more state.");
    await marker.grow(
      800,
      "Inspect the request.\nCheck one more state.\nThen continue streaming.",
    );

    expect(animateSpy).not.toHaveBeenCalled();
    expect(frameSpy).not.toHaveBeenCalled();
    expect(marker.scrollTo.mock.calls).toEqual([
      [{ top: 600, behavior: "instant" }],
      [{ top: 700, behavior: "instant" }],
    ]);
    // One transform glide per update on the body; the second starts where
    // the first still showed the text (100 px short), so nothing jumps.
    expect(marker.animate.mock.calls.map(glideStart)).toEqual([
      "translateY(100px)",
      "translateY(200px)",
    ]);
    expect(marker.animate.mock.calls[1][1]).toEqual({
      duration: 500,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
    expect(marker.glides[0].cancel).toHaveBeenCalledTimes(1);
    // The fade mask stays on the scroller, not on the sliding body.
    expect(marker.content.getAttribute("data-scrollable")).toBe("start end");
    marker.cleanup();
  });

  it("keeps the bottom fade through each glide landing until the stream ends", async () => {
    const marker = mountFollowingThinking();
    await nextTick();
    // The scroll lands exactly on the bottom before the next update arrives.
    marker.scrollTo.mockImplementation(({ top }: ScrollToOptions) => {
      marker.content.scrollTop = top ?? 0;
      marker.content.dispatchEvent(new Event("scroll"));
    });
    await marker.grow(700, "Inspect the request.\nCheck one more state.");
    await nextTick();
    expect(marker.content.scrollTop).toBe(600);
    expect(marker.content.getAttribute("data-scrollable")).toBe("start end");

    await marker.finish();
    marker.content.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(marker.content.getAttribute("data-scrollable")).toBe("start");
    marker.cleanup();
  });

  it("stops following thinking only after explicit user scroll intent", async () => {
    const animateSpy = vi
      .spyOn(animateScroll, "animateScrollTop")
      .mockImplementation(() => () => undefined);
    const marker = mountFollowingThinking();
    await nextTick();
    marker.content.scrollTop = 500;
    // Already at the bottom when the panel first reports: nothing moves.
    await marker.grow(600, "Inspect the request.\nMeasured.");
    expect(marker.scrollTo).not.toHaveBeenCalled();
    expect(marker.animate).not.toHaveBeenCalled();

    // A scroll away from the bottom without intent keeps following.
    marker.content.scrollTop = 300;
    marker.content.dispatchEvent(new Event("scroll"));
    await marker.grow(650, "Inspect the request.\nStill following.");
    expect(marker.scrollTo).toHaveBeenCalledTimes(1);
    expect(marker.scrollTo).toHaveBeenLastCalledWith({
      top: 550,
      behavior: "instant",
    });
    expect(marker.animate.mock.calls.map(glideStart)).toEqual([
      "translateY(250px)",
    ]);

    // The wheel stops the glide where it shows: 250 px short of the bottom.
    marker.scrollTo.mockClear();
    marker.content.dispatchEvent(new Event("wheel"));
    expect(marker.glides[0].cancel).toHaveBeenCalledTimes(1);
    expect(marker.scrollTo.mock.calls).toEqual([
      [{ top: 300, behavior: "instant" }],
    ]);
    marker.scrollTo.mockClear();
    marker.content.dispatchEvent(new Event("scroll"));
    await marker.grow(700, "Inspect the request.\nThe user is reading above.");
    expect(marker.scrollTo).not.toHaveBeenCalled();
    expect(marker.animate).toHaveBeenCalledTimes(1);
    expect(animateSpy).not.toHaveBeenCalled();
    // Off the bottom and no longer following: both edges fade.
    expect(marker.content.getAttribute("data-scrollable")).toBe("start end");

    // Returning to the bottom resumes following.
    marker.content.scrollTop = 600;
    marker.content.dispatchEvent(new Event("scroll"));
    await marker.grow(760, "Inspect the request.\nBack at the end.");
    expect(marker.scrollTo).toHaveBeenCalledWith({
      top: 660,
      behavior: "instant",
    });
    marker.cleanup();
  });

  it("lets a running glide land when thinking finishes and stops it on collapse", async () => {
    const marker = mountFollowingThinking();
    await nextTick();
    await marker.grow(700, "Inspect the request.\nCheck one more state.");
    expect(marker.glides).toHaveLength(1);

    await marker.finish();
    expect(marker.glides[0].cancel).not.toHaveBeenCalled();
    expect(marker.content.scrollTop).toBe(600);

    // Folding mid-glide freezes the text where it shows.
    marker.glides[0].currentTime = 0;
    marker.scrollTo.mockClear();
    await marker.wrapper.get("button").trigger("click");
    expect(marker.wrapper.get("button").attributes("aria-expanded")).toBe(
      "false",
    );
    expect(marker.glides[0].cancel).toHaveBeenCalledTimes(1);
    expect(marker.scrollTo.mock.calls).toEqual([
      [{ top: 0, behavior: "instant" }],
    ]);
    marker.cleanup();
  });

  it("renders streaming thinking block by block, writing only the last block", async () => {
    vi.useFakeTimers();
    const observers = resizeObserverStub();
    const message = {
      createdAt: "2026-08-26T00:00:00.000Z",
      id: "assistant-blocks",
      role: "assistant" as const,
      status: "streaming" as const,
      blocks: [
        { type: "thinking" as const, thinking: "First idea.\n\nSecond idea." },
        { type: "thinking" as const, thinking: "Another\n\nsummary" },
      ],
      thinkingStartedAt: Date.now(),
      thinkingStatus: "streaming" as const,
    };
    const wrapper = mount(ProjectThinkingMarker, {
      props: { message },
      global: { plugins: [createPinia(), createAppI18n("en-US")] },
    });
    await nextTick();
    const renders = () =>
      wrapper.findAllComponents(MarkdownContent).map((render) => ({
        source: render.props("source") as string,
        final: render.props("final") as boolean,
        join: render.props("flowJoin") as string | undefined,
      }));
    // Each thinking block splits on its own; only the newest block streams.
    expect(renders()).toEqual([
      { source: "First idea.", final: true, join: "end" },
      { source: "Second idea.", final: true, join: "both" },
      { source: "Another", final: true, join: "both" },
      { source: "summary", final: false, join: "start" },
    ]);

    // Finishing keeps the blocks in place; all of them are final now.
    await wrapper.setProps({
      message: { ...message, thinkingStatus: "complete" },
    });
    expect(renders().map(({ source, final }) => [source, final])).toEqual([
      ["First idea.", true],
      ["Second idea.", true],
      ["Another", true],
      ["summary", true],
    ]);

    // Once the panel has folded away, reopening renders it in one piece.
    const trigger = wrapper.get("button");
    await trigger.trigger("click");
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapper.find("[data-thinking-content]").exists()).toBe(false);
    await trigger.trigger("click");
    expect(renders()).toEqual([
      {
        source: "First idea.\n\nSecond idea.\nAnother\n\nsummary",
        final: true,
        join: undefined,
      },
    ]);
    wrapper.unmount();
    observers.restore();
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

  it("labels MCP configuration calls by operation and server name", () => {
    const added = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "mcp-config-1",
          input: {
            scope: "project",
            name: "github",
            definition: { command: "github-mcp" },
          },
          name: "mcp_config_save",
          output: { details: { saved: true, created: true } },
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(added.text()).toContain("Added MCP server github");

    const refused = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "mcp-config-2",
          input: { scope: "project", name: "github", definition: {} },
          name: "mcp_config_save",
          output: { details: { saved: false, errors: ["bad"] } },
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(refused.text()).toContain("Couldn’t add MCP server github");

    const disabled = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "mcp-config-3",
          input: { scope: "global", name: "slack", enabled: false },
          name: "mcp_config_set_enabled",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(disabled.text()).toContain("正在停用 MCP 服务器 slack");

    const activated = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "mutation-1-mcp",
          input: {},
          name: "activate_mcp_authoring",
          output: { details: { preactivated: true } },
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(activated.text()).toContain("已加载 MCP 配置工具");
  });

  it("labels automation calls by operation and automation name", () => {
    const saved = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "automation-1",
          input: { spec: { name: "Daily summary" } },
          name: "automation_save",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(saved.text()).toContain("Created automation Daily summary");

    const refused = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "automation-2",
          input: { spec: { name: "Daily summary" } },
          name: "automation_save",
          output: { details: { saved: false, errors: ["bad"] } },
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(refused.text()).toContain("Couldn’t create automation");

    const models = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "models-1",
          input: {},
          name: "ui_list_models",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(models.text()).toContain("已查看可用模型");
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

  it("describes activating Pine operations without its raw name", () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-pine-ops",
          input: {},
          name: "activate_pine_ops",
          status: "complete",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe("已激活 Pine 操作");
    expect(wrapper.findComponent(AppWindowIcon).exists()).toBe(true);
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

  it("names the submitted files in every state", async () => {
    const input = {
      files: [
        { path: "/work/out/report.md" },
        { path: "/work/out/data.csv" },
        { path: "/work/out/missing.png" },
      ],
    };
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-submit",
          input,
          name: "ui_submit_artifact",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe(
      "Submitting 3 files report.md, data.csv, missing.png",
    );
    expect(content.find("code").text()).toBe(
      "report.md, data.csv, missing.png",
    );
    expect(wrapper.findComponent(PackageCheckIcon).exists()).toBe(true);

    const files = [
      {
        path: "/work/out/report.md",
        requestedPath: "report.md",
        title: "Report",
      },
      { path: "/work/out/data.csv", requestedPath: "data.csv" },
    ];
    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        status: "complete",
        output: { details: { files, rejected: [] } },
      },
    });
    expect(content.text()).toBe("Submitted 2 files Report, data.csv");

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        output: {
          details: {
            files,
            rejected: [{ path: "missing.png", reason: "file not found" }],
          },
        },
      },
    });
    expect(content.text()).toBe("Submitted 2 of 3 files Report, data.csv");

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        status: "error",
        output: undefined,
      },
    });
    expect(content.text()).toBe(
      "Couldn’t submit report.md, data.csv, missing.png",
    );
  });

  it("names a single submitted file without a plural count", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-submit-one",
          input: { files: [{ path: "/work/out/report.md" }] },
          name: "ui_submit_artifact",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("en-US")] },
    });
    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toBe("Submitting report.md");

    const report = { path: "/work/out/report.md", requestedPath: "report.md" };
    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        status: "complete",
        output: { details: { files: [report], rejected: [] } },
      },
    });
    expect(content.text()).toBe("Submitted report.md");

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        output: {
          details: {
            files: [report],
            rejected: [{ path: "missing.png", reason: "file not found" }],
          },
        },
      },
    });
    expect(content.text()).toBe("Submitted 1 of 2 files report.md");
  });

  it("describes workbench calls as sentences", () => {
    const cases = [
      { name: "ui_workbench_state", input: {}, expected: "已查看工作台状态" },
      {
        name: "ui_workbench_open",
        input: { panel: "artifacts" },
        expected: "已在工作台显示产出文件",
      },
      {
        name: "ui_workbench_close",
        input: { panel: "preview" },
        expected: "已关闭预览卡片",
      },
      { name: "ui_workbench_close", input: {}, expected: "已关闭工作台" },
      {
        name: "ui_workbench_arrange",
        input: { top: "preview", bottom: "artifacts", split: 60 },
        expected: "已将工作台排布为上方预览、下方产出文件",
      },
      {
        name: "ui_workbench_arrange",
        input: { top: "preview", bottom: null },
        expected: "已让工作台只显示预览",
      },
    ];
    for (const testCase of cases) {
      const wrapper = mount(ProjectToolCallMarker, {
        props: {
          toolCall: {
            id: "tool-workbench",
            input: testCase.input,
            name: testCase.name,
            status: "complete",
          },
        },
        global: { plugins: [createAppI18n("zh-CN")] },
      });

      expect(wrapper.get('[data-slot="marker-content"]').text()).toBe(
        testCase.expected,
      );
      wrapper.unmount();
    }
  });

  it("describes history recall calls by what they looked up", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-recall",
          input: { query: "auth token" },
          name: "recall",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    const content = wrapper.get('[data-slot="marker-content"]');
    expect(content.text()).toContain("正在历史记录中查找");
    expect(content.text()).toContain("auth token");
    expect(content.text()).not.toContain("recall");
    expect(wrapper.findComponent(HistoryIcon).exists()).toBe(true);

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        input: { mode: "touched" },
        status: "complete",
      },
    });
    expect(content.text()).toContain("已在历史记录中查找");
    expect(content.text()).toContain("改动过的文件");

    await wrapper.setProps({
      toolCall: { ...wrapper.props("toolCall"), input: { expand: [3, 7] } },
    });
    expect(content.text()).toContain("#3, #7");
  });

  it("describes todo calls by their task", async () => {
    const wrapper = mount(ProjectToolCallMarker, {
      props: {
        toolCall: {
          id: "tool-todo",
          input: { action: "update", id: 2, status: "completed" },
          name: "todo",
          status: "running",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    const content = wrapper.get('[data-slot="marker-content"]');
    // Without a result yet, an update can only name the task by id.
    expect(content.text()).toBe("正在完成任务 #2");

    await wrapper.setProps({
      toolCall: {
        ...wrapper.props("toolCall"),
        status: "complete",
        output: {
          content: [{ type: "text", text: "Updated #2" }],
          details: {
            action: "update",
            params: {},
            tasks: [{ id: 2, subject: "Write tests", status: "completed" }],
            nextId: 3,
          },
        },
      },
    });
    expect(content.text()).toBe("完成任务 Write tests");
    expect(wrapper.findComponent(ListTodoIcon).exists()).toBe(true);

    await wrapper.setProps({
      toolCall: {
        id: "tool-todo",
        input: { action: "update", id: 9, status: "completed" },
        name: "todo",
        status: "complete",
        output: {
          content: [{ type: "text", text: "Error: #9 not found" }],
          details: {
            action: "update",
            params: {},
            tasks: [],
            nextId: 1,
            error: "#9 not found",
          },
        },
      },
    });
    expect(content.text()).toBe("任务清单操作被拒绝：#9 not found");

    await wrapper.setProps({
      toolCall: {
        id: "tool-todo",
        input: {
          action: "create",
          tasks: [
            { subject: "Locate the parser", dependsOn: [] },
            { subject: "Write tests", dependsOn: [1] },
          ],
        },
        name: "todo",
        status: "running",
      },
    });
    expect(content.text()).toContain("Locate the parser · Write tests");
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
