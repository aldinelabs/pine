import {
  deriveRoomId,
  fromBase64Url,
  readPairingUrl,
  type Identity,
} from "@pine/rc-protocol";
import { serveRequest } from "./bridge";
import {
  PINE_PREFIX,
  type BridgeRequest,
  type ShellHello,
} from "./bridgeMessages";
import { LinkError, connect, type Link, type LinkStage } from "./link";
import { pineLogo } from "./logo";
import {
  deviceIdentity,
  forgetHost,
  keepStorage,
  listHosts,
  saveHost,
  type StoredHost,
} from "./store";
import { isChinese, t, type StringKey } from "./strings";

const PAIRING_ANSWER_TIMEOUT_MS = 120_000;
const ANSWER_TIMEOUT_MS = 15_000;
const PAIRED_TIMEOUT_MS = 10_000;

const root = document.getElementById("app")!;
/** Names this page to the service worker, so it knows where to send requests. */
const token = crypto.randomUUID();
let identity: Identity;
let link: Link | undefined;
let host: StoredHost | undefined;
let frame: HTMLIFrameElement | undefined;
/** Each connection attempt; a newer one makes older results irrelevant. */
let attempt = 0;

type Child = Node | string | false | undefined;

function h(
  tag: string,
  props: Record<string, string | ((event: Event) => void)> = {},
  ...children: Child[]
): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === "function") element.addEventListener(name, value);
    else element.setAttribute(name, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

/** Shows a card above Pine, or in its place before Pine has loaded. */
function show(...children: Child[]): void {
  document.getElementById("card")?.remove();
  root.append(h("main", { id: "card" }, pineLogo(), ...children));
}

function hideCard(): void {
  document.getElementById("card")?.remove();
}

function status(message: string, ...actions: Child[]): void {
  show(
    h("div", { class: "spinner", role: "progressbar" }),
    h("p", {}, message),
    actions.length > 0 && h("div", { class: "actions" }, ...actions),
  );
}

function button(
  label: string,
  onClick: () => void,
  variant: "primary" | "secondary" = "primary",
): HTMLElement {
  return h("button", { type: "button", class: variant, click: onClick }, label);
}

function failure(error: unknown, name: string): string {
  const reason = error instanceof LinkError ? error.reason : "failed";
  return t(reason, { name });
}

function stageMessage(
  stage: LinkStage,
  name: string,
  pairing: boolean,
): string {
  if (stage === "waiting")
    return pairing ? t("confirmOnComputer") : t("connecting", { name });
  if (stage === "connecting") return t("handshaking");
  return pairing ? t("pairing") : t("connecting", { name });
}

function deviceName(): string {
  const agent = navigator.userAgent;
  if (/iPad/.test(agent)) return "iPad";
  if (/iPhone/.test(agent)) return "iPhone";
  if (/Android/.test(agent)) return "Android";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : undefined;
  const system = /Windows/.test(agent)
    ? "Windows"
    : /Mac OS X/.test(agent)
      ? "macOS"
      : /CrOS/.test(agent)
        ? "ChromeOS"
        : /Linux/.test(agent)
          ? "Linux"
          : undefined;
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? (isChinese ? "设备" : "Device");
}

function showPine(): void {
  hideCard();
  if (frame && frame.dataset.host === host?.id) return;
  frame?.remove();
  frame = h("iframe", {
    id: "pine",
    src: `${PINE_PREFIX}${token}/`,
    title: "Pine",
    allow: "clipboard-read; clipboard-write; fullscreen",
    "data-host": host?.id ?? "",
  }) as HTMLIFrameElement;
  root.append(frame);
}

function lost(closed: Link): void {
  if (link !== closed) return;
  link = undefined;
  const current = host;
  if (!current) return;
  show(
    h("p", {}, t("disconnected", { name: current.name })),
    h(
      "div",
      { class: "actions" },
      button(t("reconnect"), () => void open(current)),
      button(t("otherComputers"), () => void showList(), "secondary"),
    ),
  );
  // Coming back to the device is the usual way a connection is lost.
  if (document.visibilityState === "visible") void open(current);
}

async function finishLink(next: Link, target: StoredHost, mine: number) {
  if (mine !== attempt) {
    next.close();
    return;
  }
  link?.close();
  link = next;
  host = target;
  await saveHost({ ...target, lastConnectedAt: Date.now() });
  showPine();
}

async function open(target: StoredHost): Promise<void> {
  const mine = ++attempt;
  const choose = button(
    t("otherComputers"),
    () => void showList(),
    "secondary",
  );
  status(t("connecting", { name: target.name }), choose);
  let next: Link | undefined;
  try {
    next = await connect({
      signaling: target.signaling,
      room: await deriveRoomId(fromBase64Url(target.roomSecret), "device"),
      identity,
      hostKey: fromBase64Url(target.id),
      answerTimeoutMs: ANSWER_TIMEOUT_MS,
      onControl: () => undefined,
      onClose: () => next && lost(next),
      onStage: (stage) => {
        if (mine === attempt)
          status(stageMessage(stage, target.name, false), choose);
      },
    });
  } catch (error) {
    if (mine !== attempt) return;
    show(
      h("p", {}, failure(error, target.name)),
      h(
        "div",
        { class: "actions" },
        button(t("retry"), () => void open(target)),
        button(t("otherComputers"), () => void showList(), "secondary"),
      ),
    );
    return;
  }
  await finishLink(next, target, mine);
}

async function pair(url: string): Promise<void> {
  let offer;
  try {
    offer = readPairingUrl(url, Date.now());
  } catch (error) {
    const expired = error instanceof Error && /expired/i.test(error.message);
    show(
      h("p", {}, t(expired ? "expired" : "invalid")),
      h(
        "div",
        { class: "actions" },
        button(t("back"), () => void showList()),
      ),
    );
    return;
  }
  const mine = ++attempt;
  const secret = fromBase64Url(offer.secret);
  const name = t("computer");
  let paired: (message: Record<string, unknown>) => void = () => undefined;
  const pairedMessage = new Promise<Record<string, unknown>>((resolve) => {
    paired = resolve;
  });
  status(t("pairing"));
  let next: Link | undefined;
  try {
    next = await connect({
      signaling: offer.signaling,
      room: await deriveRoomId(secret, "pairing"),
      identity,
      hostKey: fromBase64Url(offer.hostKey),
      pairingSecret: secret,
      answerTimeoutMs: PAIRING_ANSWER_TIMEOUT_MS,
      onControl: (message) => {
        if (message.type === "paired") paired(message);
      },
      onClose: () => next && lost(next),
      onStage: (stage) => {
        if (mine === attempt) status(stageMessage(stage, name, true));
      },
    });
    const message = await Promise.race([
      pairedMessage,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new LinkError("failed")), PAIRED_TIMEOUT_MS),
      ),
    ]);
    if (typeof message.roomSecret !== "string") throw new LinkError("failed");
    const target: StoredHost = {
      id: offer.hostKey,
      name:
        typeof message.hostName === "string" && message.hostName
          ? message.hostName.slice(0, 60)
          : name,
      signaling: offer.signaling,
      roomSecret: message.roomSecret,
      pairedAt: Date.now(),
    };
    next.tunnel.send({
      type: "control",
      stream: 0,
      message: { type: "name", name: deviceName() },
    });
    await finishLink(next, target, mine);
  } catch (error) {
    next?.close();
    if (mine !== attempt) return;
    show(
      h("p", {}, failure(error, name)),
      h(
        "div",
        { class: "actions" },
        button(t("back"), () => void showList()),
      ),
    );
  }
}

async function showList(): Promise<void> {
  attempt += 1;
  const hosts = await listHosts();
  const format = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  show(
    h("h1", {}, t("title")),
    hosts.length === 0
      ? h("p", {}, t("emptyList"))
      : h(
          "ul",
          { class: "hosts" },
          ...hosts.map((item) =>
            h(
              "li",
              {},
              h(
                "button",
                { type: "button", class: "host", click: () => void open(item) },
                h("strong", {}, item.name),
                h(
                  "span",
                  {},
                  t("lastConnected", {
                    date: format.format(item.lastConnectedAt ?? item.pairedAt),
                  }),
                ),
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "forget",
                  "aria-label": t("forget"),
                  click: () => void forget(item),
                },
                "×",
              ),
            ),
          ),
        ),
  );
}

async function forget(item: StoredHost): Promise<void> {
  if (!confirm(t("forgetConfirm", { name: item.name }))) return;
  await forgetHost(item.id);
  if (host?.id === item.id) {
    link?.close();
    link = undefined;
    host = undefined;
    frame?.remove();
    frame = undefined;
  }
  await showList();
}

async function hello(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({
    type: "pine-shell",
    token,
  } satisfies ShellHello);
}

async function boot(): Promise<void> {
  document.title = t("title");
  if (
    !("serviceWorker" in navigator) ||
    typeof RTCPeerConnection === "undefined"
  ) {
    show(h("p", {}, t("unsupported")));
    return;
  }
  navigator.serviceWorker.addEventListener(
    "message",
    (event: MessageEvent<BridgeRequest>) => {
      const port = event.ports[0];
      if (event.data?.type === "pine-request" && port)
        void serveRequest(event.data, port, link?.tunnel);
    },
  );
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => void hello(),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !link && host && frame)
      void open(host);
  });
  await navigator.serviceWorker.register(
    import.meta.env.DEV ? "/src/sw.ts" : "/sw.js",
    { scope: "/", type: import.meta.env.DEV ? "module" : "classic" },
  );
  await hello();
  void keepStorage();
  identity = await deviceIdentity();

  if (location.hash.startsWith("#pair=")) {
    const url = location.href;
    // The code's secret should not linger in history or the address bar.
    history.replaceState(null, "", "/");
    await pair(url);
    return;
  }
  const hosts = await listHosts();
  if (hosts[0]) await open(hosts[0]);
  else await showList();
}

void boot().catch((error: unknown) => {
  console.error(error);
  show(h("p", {}, t("failed" satisfies StringKey)));
});
