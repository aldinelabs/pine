import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  PRIMARY_USER_ID,
  type PineUsersApi,
  type PineUsersState,
} from "@/shared/users";
import UserPickerView from "../UserPickerView.vue";

const MOM = "00000000-0000-4000-8000-000000000001";

function state(overrides: Partial<PineUsersState> = {}): PineUsersState {
  return {
    users: [
      {
        id: PRIMARY_USER_ID,
        name: "",
        avatar: null,
        color: "green",
        createdAt: "",
      },
      { id: MOM, name: "Mom", avatar: "🦊", color: "amber", createdAt: "" },
    ],
    currentUserId: null,
    lastUserId: MOM,
    askAtLaunch: true,
    damaged: false,
    ...overrides,
  };
}

let api: { [K in keyof PineUsersApi]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  setActivePinia(createPinia());
  api = {
    get: vi.fn().mockResolvedValue(state()),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setAskAtLaunch: vi.fn(),
    choose: vi.fn().mockResolvedValue(undefined),
    switchTo: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { users: api },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "pine");
});

async function mountPicker() {
  const wrapper = mount(UserPickerView, {
    attachTo: document.body,
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: { UserDialog: true, Toaster: true },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("UserPickerView", () => {
  it("shows every user, naming the primary one until they choose a name", async () => {
    const wrapper = await mountPicker();
    expect(wrapper.text()).toContain("Who's using Pine?");
    const names = wrapper.findAll("[data-slot=user-picker-name]");
    expect(names.map((name) => name.text())).toEqual(["Me", "Mom"]);
    wrapper.unmount();
  });

  it("starts with the last user focused", async () => {
    const wrapper = await mountPicker();
    expect(document.activeElement?.getAttribute("data-user-id")).toBe(MOM);
    wrapper.unmount();
  });

  it("moves between users with the arrow keys", async () => {
    const wrapper = await mountPicker();
    await wrapper.find("main").trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-slot")).toBe(
      "user-picker-add",
    );
    await wrapper.find("main").trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-user-id")).toBe(
      PRIMARY_USER_ID,
    );
    wrapper.unmount();
  });

  it("chooses a user by click or number, remembering when asked", async () => {
    const wrapper = await mountPicker();
    await wrapper.find("[data-slot=user-picker-tile]").trigger("click");
    expect(api.choose).toHaveBeenCalledWith({
      id: PRIMARY_USER_ID,
      remember: false,
    });

    const second = await mountPicker();
    await second.find("[data-testid=user-picker-remember]").trigger("click");
    await second.find("main").trigger("keydown", { key: "2" });
    expect(api.choose).toHaveBeenLastCalledWith({ id: MOM, remember: true });
    wrapper.unmount();
    second.unmount();
  });
});
