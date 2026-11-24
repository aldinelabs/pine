import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useProjectStore } from "@/stores/project";
import AssistantDispatchCard from "../AssistantDispatchCard.vue";

const openSession = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({ openSession }),
}));

function mountCard(
  entry: InstanceType<typeof AssistantDispatchCard>["$props"]["entry"],
) {
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const projects = useProjectStore(pinia);
  vi.mocked(projects.projectById).mockImplementation((id) =>
    id === "p1"
      ? ({ id: "p1", name: "Blog" } as ReturnType<typeof projects.projectById>)
      : null,
  );
  return mount(AssistantDispatchCard, {
    props: { entry },
    global: { plugins: [createAppI18n("zh-CN"), pinia] },
  });
}

describe("AssistantDispatchCard", () => {
  it("shows a report as Project › Session and opens that session", async () => {
    openSession.mockReset();
    const wrapper = mountCard({
      sessionId: "s1",
      projectId: "p1",
      title: "修首页",
      state: "finished",
    });

    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.get('[data-slot="dispatch-target"]').text()).toBe(
      "Blog修首页",
    );
    await wrapper.trigger("click");
    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", name: "修首页" }),
      "p1",
    );
    wrapper.unmount();
  });

  it("opens nothing while the dispatch has not started a session", async () => {
    openSession.mockReset();
    const wrapper = mountCard({
      projectId: "p1",
      title: "修首页",
      state: "dispatching",
    });

    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.text()).toContain("正在派活");
    await wrapper.trigger("click");
    expect(openSession).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
