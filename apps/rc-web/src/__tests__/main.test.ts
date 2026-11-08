import { afterEach, expect, it, vi } from "vitest";
import type { LinkOptions } from "../link";
import type { StoredHost } from "../store";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  listHosts: vi.fn(),
  saveHost: vi.fn(),
}));
vi.mock("../App.vue", () => ({ default: {} }));
vi.mock("vue", async (original) => ({
  ...(await original<typeof import("vue")>()),
  createApp: () => ({ use: () => ({ mount: vi.fn() }) }),
}));
vi.mock("../i18n", () => ({ i18n: {}, t: (key: string) => key }));
vi.mock("../store", () => ({
  deviceIdentity: async () => ({}),
  keepStorage: vi.fn(),
  listHosts: mocks.listHosts,
  saveHost: mocks.saveHost,
  forgetHost: vi.fn(),
}));
vi.mock("../link", () => ({
  connect: mocks.connect,
  LinkError: class extends Error {},
}));
vi.mock("@pine/rc-protocol", () => ({
  deriveRoomId: async () => "room",
  fromBase64Url: () => new Uint8Array(),
  readPairingUrl: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it("switches between two computers without reconnecting the closed one", async () => {
  const hosts: StoredHost[] = ["a", "b"].map((id) => ({
    id,
    name: id,
    signaling: "https://signal.test",
    roomSecret: "secret",
    pairedAt: 1,
  }));
  mocks.listHosts.mockResolvedValue(hosts);
  mocks.saveHost.mockResolvedValue(undefined);
  const listeners = new Map<string, (event: unknown) => void>();
  const frames: Array<{
    dataset: Record<string, string>;
    contentWindow: object;
    remove: () => void;
  }> = [];
  vi.stubGlobal("document", {
    getElementById: () => ({ append: vi.fn() }),
    visibilityState: "visible",
    documentElement: { classList: { toggle: vi.fn() } },
    addEventListener: vi.fn(),
    createElement: () => {
      const frame = { dataset: {}, contentWindow: {}, remove: vi.fn() };
      frames.push(frame);
      return frame;
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
  });
  vi.stubGlobal("location", { origin: "https://rc.test", hash: "" });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
      register: vi.fn(),
      addEventListener: vi.fn(),
    },
  });
  vi.stubGlobal("RTCPeerConnection", class {});
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
  }));
  const links: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  mocks.connect.mockImplementation(async (options: LinkOptions) => {
    const link = { tunnel: {}, close: vi.fn(() => options.onClose()) };
    links.push(link);
    return link;
  });
  await import("../main");
  const { view } = await import("../view");
  await vi.waitFor(() => expect(view.value.kind).toBe("pine"));
  const showList = async () => {
    listeners.get("message")!({
      origin: "https://rc.test",
      source: frames.at(-1)!.contentWindow,
      data: { type: "pine-switch-computer" },
    });
    await vi.waitFor(() => expect(view.value.kind).toBe("list"));
  };
  await showList();
  expect(links[0]!.close).toHaveBeenCalledOnce();
  if (view.value.kind !== "list") throw new Error("Expected computer list");
  view.value.open(hosts[1]!);
  await vi.waitFor(() => expect(view.value.kind).toBe("pine"));
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  await showList();
  if (view.value.kind !== "list") throw new Error("Expected computer list");
  view.value.open(hosts[0]!);
  await vi.waitFor(() => expect(view.value.kind).toBe("pine"));
  expect(mocks.connect).toHaveBeenCalledTimes(3);
  expect(
    mocks.connect.mock.calls.map(([options]) => options.signaling),
  ).toHaveLength(3);
});
