import { createTestingPinia } from "@pinia/testing";
import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useSessionStore } from "@/stores/session";
import ProjectTitleSuggestion from "../ProjectTitleSuggestion.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function mountSuggestion() {
  const pinia = createTestingPinia({ createSpy: vi.fn });
  const wrapper = mount(ProjectTitleSuggestion, {
    props: { sessionId: "session-1", suggestion: "Fix the sidebar" },
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  wrappers.push(wrapper);
  return { wrapper, store: useSessionStore(pinia) };
}

it("shows the proposed title with its three answers", () => {
  const { wrapper } = mountSuggestion();

  expect(wrapper.text()).toContain("Rename this session to “Fix the sidebar”?");
  expect(
    wrapper.findAll("[data-reply]").map((button) => button.text()),
  ).toEqual(["Don't suggest again", "Not now", "Rename"]);
});

it.each(["accept", "dismiss", "never"] as const)(
  "sends the %s answer for the session",
  async (reply) => {
    const { wrapper, store } = mountSuggestion();

    await wrapper.get(`[data-reply="${reply}"]`).trigger("click");

    expect(store.replyTitleSuggestion).toHaveBeenCalledWith("session-1", reply);
  },
);
