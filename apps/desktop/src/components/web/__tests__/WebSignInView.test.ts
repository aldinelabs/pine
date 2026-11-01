import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import WebSignInView from "../WebSignInView.vue";

function mountView() {
  return mount(WebSignInView, {
    global: { plugins: [createAppI18n("en-US")] },
  });
}

async function submit(wrapper: ReturnType<typeof mountView>, password: string) {
  await wrapper.get('[data-testid="web-sign-in-password"]').setValue(password);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WebSignInView", () => {
  it("signs in with the password", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountView();
    expect(
      wrapper.get('[data-testid="web-sign-in-submit"]').attributes("disabled"),
    ).toBeDefined();
    await submit(wrapper, "correct horse");
    expect(fetch).toHaveBeenCalledWith(
      "/api/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "correct horse" }),
      }),
    );
    expect(wrapper.emitted("signedIn")).toHaveLength(1);
  });

  it("explains a wrong password and an unreachable Pine", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    const wrapper = mountView();
    await submit(wrapper, "wrong horse");
    expect(wrapper.get('[data-testid="web-sign-in-error"]').text()).toBe(
      "That password is incorrect.",
    );
    await submit(wrapper, "wrong horse");
    expect(wrapper.get('[data-testid="web-sign-in-error"]').text()).toContain(
      "could not be reached",
    );
    expect(wrapper.emitted("signedIn")).toBeUndefined();
  });

  it("counts down a lockout before allowing another attempt", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
        ),
    );
    const wrapper = mountView();
    await submit(wrapper, "guess");
    const button = () => wrapper.get('[data-testid="web-sign-in-submit"]');
    expect(wrapper.text()).toContain("Try again in 2 s.");
    expect(button().attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toContain("Try again in 1 s.");
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find('[data-testid="web-sign-in-error"]').exists()).toBe(
      false,
    );
    expect(button().attributes("disabled")).toBeUndefined();
  });
});
