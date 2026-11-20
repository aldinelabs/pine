import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  PRIMARY_USER_ID,
  type PineUser,
  type PineUsersState,
} from "@/shared/users";
import UserDialog from "../UserDialog.vue";

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
  color: "blue" as const,
  createdAt: "",
};

function state(users = [primary, mom]): PineUsersState {
  return {
    users,
    currentUserId: PRIMARY_USER_ID,
    lastUserId: PRIMARY_USER_ID,
    askAtLaunch: true,
    damaged: false,
  };
}

let create: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setActivePinia(createPinia());
  create = vi.fn().mockResolvedValue(state());
  update = vi.fn().mockResolvedValue(state());
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      users: {
        get: vi.fn().mockResolvedValue(state([primary])),
        create,
        update,
        onChanged: () => () => undefined,
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "pine");
  document.body.innerHTML = "";
});

function mountDialog(props: { user: PineUser | null; offerCopy?: boolean }) {
  return mount(UserDialog, {
    attachTo: document.body,
    props: { open: true, ...props },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

function body(selector: string): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

async function typeName(value: string): Promise<void> {
  const input = body("[data-testid=user-dialog-name]") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

describe("UserDialog", () => {
  it("adds a user and copies model connections by default", async () => {
    const wrapper = mountDialog({ user: null, offerCopy: true });
    await flushPromises();
    await typeName("  Mom ");
    body("[data-slot=user-avatar-option][aria-label='🦊']").click();
    body("[data-slot=user-color-option][aria-label=Amber]").click();
    await flushPromises();
    body("[data-testid=user-dialog-save]").click();
    await flushPromises();
    expect(create).toHaveBeenCalledWith({
      name: "Mom",
      avatar: "🦊",
      color: "amber",
      copyModelConnections: true,
    });
    expect(wrapper.emitted("saved")?.[0]).toEqual([mom]);
    wrapper.unmount();
  });

  it("offers no copy from the picker", async () => {
    const wrapper = mountDialog({ user: null });
    await flushPromises();
    expect(document.body.querySelector("[data-testid=user-dialog-copy]")).toBe(
      null,
    );
    await typeName("Mom");
    body("[data-testid=user-dialog-save]").click();
    await flushPromises();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ copyModelConnections: false }),
    );
    wrapper.unmount();
  });

  it("explains a refused name", async () => {
    create.mockRejectedValue(
      new Error("Error invoking remote method: duplicate-name: taken"),
    );
    const wrapper = mountDialog({ user: null, offerCopy: true });
    await flushPromises();
    await typeName("Kai");
    body("[data-testid=user-dialog-save]").click();
    await flushPromises();
    expect(body("[data-testid=user-dialog-error]").textContent).toContain(
      "Another user already has this name.",
    );
    wrapper.unmount();
  });

  it("edits a user's name, avatar and colour", async () => {
    const wrapper = mountDialog({ user: mom });
    await flushPromises();
    expect(
      (body("[data-testid=user-dialog-name]") as HTMLInputElement).value,
    ).toBe("Mom");
    await typeName("Mum");
    body("[data-slot=user-avatar-option][aria-label=Initial]").click();
    await flushPromises();
    body("[data-testid=user-dialog-save]").click();
    await flushPromises();
    expect(update).toHaveBeenCalledWith({
      id: MOM,
      name: "Mum",
      avatar: null,
      color: "blue",
    });
    wrapper.unmount();
  });
});
