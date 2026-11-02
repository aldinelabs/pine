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
import { createApp } from "vue";
import App from "./App.vue";
import { i18n, t } from "./i18n";
import "./index.css";
import { LinkError, connect, type Link, type LinkStage } from "./link";
import {
  deviceIdentity,
  forgetHost,
  keepStorage,
  listHosts,
  saveHost,
  type StoredHost,
} from "./store";
import { view, type Message, type ViewAction } from "./view";

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

/** Shows a message above Pine, or in its place before Pine has loaded. */
function status(message: Message, ...actions: ViewAction[]): void {
  view.value = { kind: "status", message, busy: true, actions };
}

/** Like status, but nothing is in progress: the person decides what next. */
function notice(message: Message, ...actions: ViewAction[]): void {
  view.value = { kind: "status", message, busy: false, actions };
}

const chooseAnother: ViewAction = {
  label: "otherComputers",
  run: () => void showList(),
};

function failure(error: unknown, name: string): Message {
  const reason = error instanceof LinkError ? error.reason : "failed";
  return { key: reason, values: { name } };
}

function stageMessage(
  stage: LinkStage,
  name: string,
  pairing: boolean,
): Message {
  if (stage === "waiting")
    return pairing
      ? { key: "confirmOnComputer" }
      : { key: "connecting", values: { name } };
  if (stage === "connecting") return { key: "handshaking" };
  return pairing ? { key: "pairing" } : { key: "connecting", values: { name } };
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
  return browser ?? system ?? t("device");
}

function showPine(): void {
  view.value = { kind: "pine" };
  if (frame && frame.dataset.host === host?.id) return;
  frame?.remove();
  frame = document.createElement("iframe");
  frame.id = "pine";
  frame.src = `${PINE_PREFIX}${token}/`;
  frame.title = "Pine";
  frame.allow = "clipboard-read; clipboard-write; fullscreen";
  frame.dataset.host = host?.id ?? "";
  root.append(frame);
}

function lost(closed: Link): void {
  if (link !== closed) return;
  link = undefined;
  const current = host;
  if (!current) return;
  notice(
    { key: "disconnected", values: { name: current.name } },
    { label: "reconnect", run: () => void open(current), primary: true },
    chooseAnother,
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
  status({ key: "connecting", values: { name: target.name } }, chooseAnother);
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
          status(stageMessage(stage, target.name, false), chooseAnother);
      },
    });
  } catch (error) {
    if (mine !== attempt) return;
    notice(
      failure(error, target.name),
      { label: "retry", run: () => void open(target), primary: true },
      chooseAnother,
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
    notice(
      { key: expired ? "expired" : "invalid" },
      { label: "back", run: () => void showList(), primary: true },
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
  status({ key: "pairing" });
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
    notice(failure(error, name), {
      label: "back",
      run: () => void showList(),
      primary: true,
    });
  }
}

async function showList(): Promise<void> {
  attempt += 1;
  view.value = {
    kind: "list",
    hosts: await listHosts(),
    open: (item) => void open(item),
    forget,
  };
}

async function forget(item: StoredHost): Promise<void> {
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
  if (
    !("serviceWorker" in navigator) ||
    typeof RTCPeerConnection === "undefined"
  ) {
    notice({ key: "unsupported" });
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

// Pine's own palette, light or dark with the system like the desktop app.
const darkScheme = matchMedia("(prefers-color-scheme: dark)");
function applyScheme(): void {
  document.documentElement.classList.toggle("dark", darkScheme.matches);
}
applyScheme();
darkScheme.addEventListener("change", applyScheme);

createApp(App).use(i18n).mount("#ui");
void boot().catch((error: unknown) => {
  console.error(error);
  notice({ key: "failed" });
});
