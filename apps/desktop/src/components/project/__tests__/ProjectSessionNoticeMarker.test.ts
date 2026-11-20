import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectSessionNoticeMarker from "../ProjectSessionNoticeMarker.vue";

vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({ openSession: vi.fn() }),
}));

describe("ProjectSessionNoticeMarker", () => {
  it("says the user stopped the sub-session", () => {
    const wrapper = mount(ProjectSessionNoticeMarker, {
      props: {
        notice: {
          sessionId: "s1",
          projectId: "p1",
          title: "Docs pass",
          state: "stopped",
        },
      },
      global: {
        plugins: [
          createAppI18n("en-US"),
          createTestingPinia({ createSpy: vi.fn }),
        ],
      },
    });

    expect(wrapper.text()).toBe("You stopped sub-session Docs pass");
    expect(wrapper.attributes("data-state")).toBe("stopped");
    wrapper.unmount();
  });
});
