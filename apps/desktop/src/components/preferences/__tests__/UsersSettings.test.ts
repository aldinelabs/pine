import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { PRIMARY_USER_ID, type PineUsersState } from "@/shared/users";
import UsersSettings from "../UsersSettings.vue";

const MOM = "00000000-0000-4000-8000-000000000001";
const primary = {
  id: PRIMARY_USER_ID,
  name: "Kai",
  avatar: null,
  color: "green" as const,
  createdAt: "",
};
const mom = {
  id: MOM,
  name: "Mom",
  avatar: "🦊" as const,
  color: "amber" as const,
  createdAt: "",
};

function state(overrides: Partial<PineUsersState> = {}): PineUsersState {
  return {
    users: [primary, mom],
    currentUserId: PRIMARY_USER_ID,
    lastUserId: PRIMARY_USER_ID,
    askAtLaunch: true,
    damaged: false,
    ...overrides,
  };
}

let api: Record<string, ReturnType<typeof vi.fn>>;

function install(initial: PineUsersState): void {
  api = {
    get: vi.fn().mockResolvedValue(initial),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn().mockResolvedValue(state({ users: [primary] })),
    setAskAtLaunch: vi
      .fn()
      .mockImplementation((ask: boolean) =>
        Promise.resolve(state({ askAtLaunch: ask })),
      ),
    choose: vi.fn(),
    switchTo: vi.fn().mockResolvedValue("restarting"),
    onChanged: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { users: api },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  Reflect.deleteProperty(window, "pine");
  document.body.innerHTML = "";
});

async function mountSettings() {
  const wrapper = mount(UsersSettings, {
    attachTo: document.body,
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: { UserDialog: true },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("UsersSettings", () => {
  it("shows a single user without the multi-user switches", async () => {
    install(state({ users: [{ ...primary, name: "" }] }));
    const wrapper = await mountSettings();
    const rows = wrapper.findAll("[data-slot=users-settings-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("Me");
    expect(rows[0].text()).toContain("Current");
    expect(wrapper.find("[data-testid=users-ask-at-launch]").exists()).toBe(
      false,
    );
    expect(wrapper.find("[data-action=user-actions]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("offers switching and deleting for other users only", async () => {
    install(state());
    const wrapper = await mountSettings();
    const [kai, other] = wrapper.findAll("[data-slot=users-settings-row]");
    expect(kai.find("[data-action=user-actions]").exists()).toBe(false);
    expect(other.find("[data-action=user-actions]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=users-background-note]").exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("turns the launch question off", async () => {
    install(state());
    const wrapper = await mountSettings();
    await wrapper.find("[data-testid=users-ask-at-launch]").trigger("click");
    await flushPromises();
    expect(api.setAskAtLaunch).toHaveBeenCalledWith(false);
    wrapper.unmount();
  });

  it("disables changes when the list cannot be read", async () => {
    install(state({ users: [primary], damaged: true }));
    const wrapper = await mountSettings();
    expect(wrapper.text()).toContain("can't read its list of users");
    expect(
      wrapper.find("[data-testid=users-settings-add]").attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
});
