import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PRIMARY_USER_ID, type PineUsersState } from "@/shared/users";
import UserSwitcher from "../UserSwitcher.vue";

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

let switchTo: ReturnType<typeof vi.fn>;

function install(users: PineUsersState["users"]): void {
  switchTo = vi.fn().mockResolvedValue("restarting");
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      users: {
        get: vi.fn().mockResolvedValue({
          users,
          currentUserId: PRIMARY_USER_ID,
          lastUserId: PRIMARY_USER_ID,
          askAtLaunch: true,
          damaged: false,
        }),
        switchTo,
        onChanged: () => () => undefined,
      },
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  Reflect.deleteProperty(window, "pine");
  document.body.innerHTML = "";
});

async function mountSwitcher() {
  const wrapper = mount(
    {
      components: { SidebarProvider, UserSwitcher },
      emits: ["manage"],
      template:
        "<SidebarProvider><UserSwitcher @manage-users=\"$emit('manage')\" /></SidebarProvider>",
    },
    { attachTo: document.body, global: { plugins: [createAppI18n("en-US")] } },
  );
  await flushPromises();
  return wrapper;
}

async function openMenu(): Promise<void> {
  const trigger = document.body.querySelector<HTMLElement>(
    "[data-testid=user-switcher-trigger]",
  )!;
  trigger.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await flushPromises();
}

describe("UserSwitcher", () => {
  it("shows nothing for a single user", async () => {
    install([primary]);
    const wrapper = await mountSwitcher();
    expect(wrapper.find("[data-slot=user-switcher]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("switches to another user and opens the manager", async () => {
    install([primary, mom]);
    const wrapper = await mountSwitcher();
    expect(wrapper.text()).toContain("Kai");
    await openMenu();
    const option = document.body.querySelector<HTMLElement>(
      "[data-slot=user-switcher-option]",
    );
    expect(option?.dataset.userId).toBe(MOM);
    option?.click();
    await flushPromises();
    expect(switchTo).toHaveBeenCalledWith(MOM);

    await openMenu();
    document.body
      .querySelector<HTMLElement>("[data-action=manage-users]")
      ?.click();
    await flushPromises();
    expect(wrapper.emitted("manage")).toHaveLength(1);
    wrapper.unmount();
  });
});
