import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import {
  DEFAULT_WECHAT_SETTINGS,
  DEFAULT_WECHAT_STATUS,
  type WeChatSettings,
  type WeChatStatus,
} from "@/shared/wechatRemote";
import { useProjectStore } from "@/stores/project";
import WeChatRemoteSettings from "../WeChatRemoteSettings.vue";

const QR_CONTENT = "https://liteapp.weixin.qq.com/q/secret-qr?bot_type=3";

const unbound: WeChatStatus = {
  ...DEFAULT_WECHAT_STATUS,
  settings: { ...DEFAULT_WECHAT_SETTINGS },
};
const bound: WeChatStatus = {
  ...unbound,
  bound: true,
  connection: "online",
  owner: { userDigest: "A1B2-C3D4", boundAt: Date.UTC(2026, 10, 1, 12) },
};
const qrPhase: WeChatStatus = {
  ...unbound,
  connection: "connecting",
  binding: {
    phase: "qr",
    qrContent: QR_CONTENT,
    expiresAt: Date.now() + 2 * 60_000,
  },
};

function withSettings(settings: Partial<WeChatSettings>): WeChatStatus {
  return { ...bound, settings: { ...bound.settings, ...settings } };
}

/** Select menus are plain elements here, so their options can be read. */
const selectStubs = {
  Select: {
    name: "Select",
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template: '<div data-select :data-value="modelValue"><slot /></div>',
  },
  SelectTrigger: { template: "<div><slot /></div>" },
  SelectValue: { template: "<span />" },
  SelectContent: { template: "<div><slot /></div>" },
  SelectGroup: { template: "<div><slot /></div>" },
  SelectItem: {
    props: ["value"],
    template: '<div data-option :data-value="value"><slot /></div>',
  },
};

type Listener = (status: WeChatStatus) => void;

function mountWith(
  pine: Record<string, unknown>,
  options: { locale?: "en-US" | "zh-CN"; projects?: PineProject[] } = {},
) {
  let push: Listener | undefined;
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      openExternalUrl: vi.fn().mockResolvedValue(undefined),
      onWeChatRemoteChanged: (listener: Listener) => {
        push = listener;
        return () => undefined;
      },
      ...pine,
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  if (options.projects) useProjectStore().projects = options.projects;
  const wrapper = mount(WeChatRemoteSettings, {
    attachTo: document.body,
    global: {
      plugins: [pinia, createAppI18n(options.locale ?? "en-US")],
      stubs: selectStubs,
    },
  });
  return {
    wrapper,
    push: async (status: WeChatStatus) => {
      push!(status);
      await flushPromises();
    },
  };
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.querySelector<T>(`[data-testid="${id}"]`);
}

function switchOf(wrapper: VueWrapper, id: string) {
  const found = wrapper
    .findAllComponents(Switch)
    .find((candidate) => candidate.vm.$attrs["data-testid"] === id);
  if (!found) throw new Error(`Missing switch ${id}`);
  return found;
}

function selectOf(wrapper: VueWrapper, index: number) {
  const found = wrapper.findAllComponents({ name: "Select" })[index];
  if (!found) throw new Error(`Missing select ${index}`);
  return found;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("WeChat remote settings", () => {
  it("starts binding and shows the QR code without its content", async () => {
    const startWeChatBinding = vi.fn().mockResolvedValue(qrPhase);
    const { wrapper } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(unbound),
      startWeChatBinding,
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Experimental");
    expect(wrapper.text()).toContain("No WeChat account is connected.");
    // Settings belong to a bound account.
    expect(wrapper.find('[data-testid="pine-wechat-receive"]').exists()).toBe(
      false,
    );

    await wrapper.get('[data-testid="pine-wechat-connect"]').trigger("click");
    await flushPromises();
    expect(startWeChatBinding).toHaveBeenCalled();
    expect(
      byTestId("pine-wechat-qr")?.querySelector("path")?.getAttribute("d"),
    ).toMatch(/^M\d/);
    expect(byTestId("pine-wechat-phase")?.textContent).toContain(
      "Scan the code with WeChat on your phone.",
    );
    expect(byTestId("pine-wechat-countdown")?.textContent).toMatch(
      /Expires in [12]:\d\d\./,
    );
    expect(document.body.innerHTML).not.toContain("secret-qr");
    wrapper.unmount();
  });

  it("follows the binding phases and submits the verify code", async () => {
    const submitWeChatVerifyCode = vi.fn().mockResolvedValue({
      ...qrPhase,
      binding: { phase: "confirming", expiresAt: Date.now() + 60_000 },
    });
    const { wrapper, push } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(unbound),
      startWeChatBinding: vi.fn().mockResolvedValue(qrPhase),
      submitWeChatVerifyCode,
    });
    await flushPromises();
    await wrapper.get('[data-testid="pine-wechat-connect"]').trigger("click");
    await flushPromises();

    await push({
      ...qrPhase,
      binding: { ...qrPhase.binding!, phase: "scanned" },
    });
    expect(byTestId("pine-wechat-phase")?.textContent).toContain(
      "Scanned. Confirm on your phone.",
    );

    const verify = { ...qrPhase.binding!, phase: "verify-code" as const };
    await push({ ...qrPhase, binding: verify });
    expect(byTestId("pine-wechat-qr")).toBeNull();
    const input = byTestId<HTMLInputElement>("pine-wechat-verify-code")!;
    await type(input, " 4821 ");
    (input.form as HTMLFormElement).requestSubmit();
    await flushPromises();
    expect(submitWeChatVerifyCode).toHaveBeenCalledWith("4821");
    expect(byTestId("pine-wechat-phase")?.textContent).toContain("Confirming…");

    await push({ ...qrPhase, binding: { ...verify, verifyRetry: true } });
    expect(document.body.textContent).toContain(
      "That code was not accepted. Try again.",
    );
    wrapper.unmount();
  });

  it("asks for the pairing code from WeChat and closes once bound", async () => {
    const pairing: WeChatStatus = {
      ...qrPhase,
      binding: {
        phase: "pairing",
        pairing: {
          codeSent: true,
          attemptsLeft: 3,
          expiresAt: Date.now() + 5 * 60_000,
        },
      },
    };
    const submitWeChatPairingCode = vi.fn().mockResolvedValue({
      ...pairing,
      binding: {
        ...pairing.binding!,
        pairing: { ...pairing.binding!.pairing!, attemptsLeft: 2 },
      },
    });
    const { wrapper, push } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(unbound),
      startWeChatBinding: vi.fn().mockResolvedValue(qrPhase),
      submitWeChatPairingCode,
    });
    await flushPromises();
    await wrapper.get('[data-testid="pine-wechat-connect"]').trigger("click");
    await flushPromises();
    await push(pairing);

    expect(byTestId("pine-wechat-pairing-instructions")?.textContent).toContain(
      "In WeChat, send any message (a single dot is enough) to the bot. It replies with a 6-digit code. Enter it here.",
    );
    expect(document.body.textContent).toContain("Attempts left: 3");
    expect(byTestId("pine-wechat-countdown")?.textContent).toMatch(
      /Expires in [45]:\d\d\./,
    );

    const input = byTestId<HTMLInputElement>("pine-wechat-pairing-code")!;
    await type(input, "12345");
    expect(
      byTestId<HTMLButtonElement>("pine-wechat-submit-pairing")!.disabled,
    ).toBe(true);
    (input.form as HTMLFormElement).requestSubmit();
    await flushPromises();
    expect(submitWeChatPairingCode).not.toHaveBeenCalled();

    await type(input, "654321");
    (input.form as HTMLFormElement).requestSubmit();
    await flushPromises();
    expect(submitWeChatPairingCode).toHaveBeenCalledWith("654321");
    expect(document.body.textContent).toContain("Attempts left: 2");

    await push(bound);
    expect(byTestId("pine-wechat-pairing-code")).toBeNull();
    expect(wrapper.text()).toContain("WeChat account A1B2-C3D4");
    wrapper.unmount();
  });

  it("cancels binding when the dialog closes", async () => {
    const cancelWeChatBinding = vi.fn().mockResolvedValue(unbound);
    const { wrapper } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(unbound),
      startWeChatBinding: vi.fn().mockResolvedValue(qrPhase),
      cancelWeChatBinding,
    });
    await flushPromises();
    await wrapper.get('[data-testid="pine-wechat-connect"]').trigger("click");
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!
      .click();
    await flushPromises();
    expect(cancelWeChatBinding).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("offers a new code once the QR code expires", async () => {
    const startWeChatBinding = vi.fn().mockResolvedValue({
      ...qrPhase,
      binding: { ...qrPhase.binding!, expiresAt: Date.now() - 1 },
    });
    const { wrapper } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(unbound),
      startWeChatBinding,
    });
    await flushPromises();
    await wrapper.get('[data-testid="pine-wechat-connect"]').trigger("click");
    await flushPromises();
    expect(byTestId("pine-wechat-qr")).toBeNull();
    expect(byTestId("pine-wechat-expired")).not.toBeNull();
    byTestId<HTMLButtonElement>("pine-wechat-try-again")!.click();
    await flushPromises();
    expect(startWeChatBinding).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("shows the bound account and its connection", async () => {
    const startWeChatBinding = vi.fn().mockResolvedValue(qrPhase);
    const { wrapper, push } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(bound),
      startWeChatBinding,
    });
    await flushPromises();
    expect(wrapper.text()).toContain("WeChat account A1B2-C3D4");
    expect(wrapper.text()).toContain("Connected Nov 1, 2026");
    expect(wrapper.get('[data-testid="pine-wechat-status"]').text()).toBe(
      "Online",
    );
    expect(wrapper.find('[data-testid="pine-wechat-connect"]').exists()).toBe(
      false,
    );

    await push({ ...bound, connection: "retrying" });
    expect(wrapper.get('[data-testid="pine-wechat-status"]').text()).toBe(
      "Retrying",
    );
    await push({ ...bound, paused: true });
    expect(wrapper.get('[data-testid="pine-wechat-status"]').text()).toBe(
      "Paused",
    );
    expect(
      wrapper.find('[data-testid="pine-wechat-scan-again"]').exists(),
    ).toBe(false);

    await push({ ...bound, connection: "reauth-required" });
    expect(wrapper.get('[data-testid="pine-wechat-status"]').text()).toBe(
      "Scan again needed",
    );
    await wrapper
      .get('[data-testid="pine-wechat-scan-again"]')
      .trigger("click");
    await flushPromises();
    expect(startWeChatBinding).toHaveBeenCalled();
    expect(byTestId("pine-wechat-qr")).not.toBeNull();
    wrapper.unmount();
  });

  it("pauses and resumes receiving tasks", async () => {
    const setWeChatPaused = vi
      .fn()
      .mockImplementation((paused: boolean) =>
        Promise.resolve({ ...bound, paused }),
      );
    const { wrapper } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(bound),
      setWeChatPaused,
    });
    await flushPromises();
    switchOf(wrapper, "pine-wechat-receive").vm.$emit(
      "update:modelValue",
      false,
    );
    await flushPromises();
    expect(setWeChatPaused).toHaveBeenCalledWith(true);
    switchOf(wrapper, "pine-wechat-receive").vm.$emit(
      "update:modelValue",
      true,
    );
    await flushPromises();
    expect(setWeChatPaused).toHaveBeenLastCalledWith(false);
    wrapper.unmount();
  });

  it("warns under a YOLO ceiling and offers default modes within it", async () => {
    const { wrapper, push } = mountWith({
      getWeChatRemote: vi.fn().mockResolvedValue(bound),
    });
    await flushPromises();
    const defaultModes = () =>
      selectOf(wrapper, 2)
        .findAll("[data-option]")
        .map((option) => option.attributes("data-value"));
    expect(
      wrapper.find('[data-testid="pine-wechat-yolo-warning"]').exists(),
    ).toBe(false);
    expect(defaultModes()).toEqual(["let-me-review", "auto-approve"]);

    await push(withSettings({ ceilingMode: "autonomous" }));
    expect(defaultModes()).toEqual([
      "let-me-review",
      "auto-approve",
      "autonomous",
    ]);

    await push(withSettings({ ceilingMode: "YOLO" }));
    expect(
      wrapper.get('[data-testid="pine-wechat-yolo-warning"]').text(),
    ).toContain(
      "With YOLO, anyone who gets into your WeChat account controls this computer.",
    );
    expect(defaultModes()).toHaveLength(4);
    wrapper.unmount();
  });

  it("sends one patch per changed setting", async () => {
    const setWeChatSettings = vi.fn().mockResolvedValue(bound);
    const project = { id: "p1", name: "Website" } as PineProject;
    const { wrapper, push } = mountWith(
      { getWeChatRemote: vi.fn().mockResolvedValue(bound), setWeChatSettings },
      {
        projects: [
          project,
          { id: TEMPORARY_WORKSPACE_PROJECT_ID, name: "tmp" } as PineProject,
        ],
      },
    );
    await flushPromises();

    const projectOptions = selectOf(wrapper, 0)
      .findAll("[data-option]")
      .map((option) => option.text());
    expect(projectOptions).toEqual(["No Project", "Website"]);

    const patches: unknown[] = [];
    const expectPatch = async (patch: unknown, act: () => void) => {
      act();
      await flushPromises();
      patches.push(patch);
      expect(setWeChatSettings).toHaveBeenLastCalledWith(patch);
    };
    await expectPatch({ defaultProjectId: "p1" }, () =>
      selectOf(wrapper, 0).vm.$emit("update:modelValue", "p1"),
    );
    await expectPatch({ ceilingMode: "YOLO" }, () =>
      selectOf(wrapper, 1).vm.$emit("update:modelValue", "YOLO"),
    );
    await expectPatch({ defaultMode: "let-me-review" }, () =>
      selectOf(wrapper, 2).vm.$emit("update:modelValue", "let-me-review"),
    );
    await expectPatch({ allowHighRiskApprovals: true }, () =>
      switchOf(wrapper, "pine-wechat-high-risk").vm.$emit(
        "update:modelValue",
        true,
      ),
    );
    await expectPatch({ allowFileSending: true }, () =>
      switchOf(wrapper, "pine-wechat-files").vm.$emit(
        "update:modelValue",
        true,
      ),
    );
    await expectPatch({ keepAwake: true }, () =>
      switchOf(wrapper, "pine-wechat-keep-awake").vm.$emit(
        "update:modelValue",
        true,
      ),
    );
    expect(setWeChatSettings).toHaveBeenCalledTimes(patches.length);

    // "No Project" clears the default project instead of naming one.
    await push(withSettings({ defaultProjectId: "p1" }));
    expect(selectOf(wrapper, 0).attributes("data-value")).toBe("p1");
    await expectPatch({ defaultProjectId: null }, () =>
      selectOf(wrapper, 0).vm.$emit("update:modelValue", "no-project"),
    );
    wrapper.unmount();
  });

  it("disconnects only after confirmation", async () => {
    const unbindWeChat = vi.fn().mockResolvedValue(unbound);
    const { wrapper } = mountWith(
      { getWeChatRemote: vi.fn().mockResolvedValue(bound), unbindWeChat },
      { locale: "zh-CN" },
    );
    await flushPromises();
    await wrapper
      .get('[data-testid="pine-wechat-disconnect"]')
      .trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("断开微信？");
    expect(document.body.textContent).toContain(
      "只由微信持有的会话会停止，微信的权限设置会恢复为默认值。",
    );
    expect(unbindWeChat).not.toHaveBeenCalled();
    byTestId<HTMLButtonElement>("pine-wechat-confirm-disconnect")!.click();
    await flushPromises();
    expect(unbindWeChat).toHaveBeenCalled();
    expect(wrapper.text()).toContain("尚未连接微信账号。");
    wrapper.unmount();
  });

  it("explains settings that were reset and links to the server guide", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const { wrapper } = mountWith({
      getWeChatRemote: vi
        .fn()
        .mockResolvedValue({ ...bound, paused: true, error: "settings-reset" }),
      openExternalUrl,
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="pine-wechat-error"]').text()).toBe(
      "WeChat settings could not be read and were reset. WeChat remote is paused.",
    );
    expect(wrapper.text()).toContain(
      "The connected account can read session titles, search results and replies of every project.",
    );
    await wrapper
      .get('[data-testid="pine-wechat-server-guide"]')
      .trigger("click");
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://docs.aldine.cn/en/pine/advanced/server/",
    );
    wrapper.unmount();
  });
});
