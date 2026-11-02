const zh = {
  title: "Pine 远程控制",
  unsupported: "这个浏览器不支持远程控制。请使用最新版的 Safari 或 Chrome。",
  pairing: "正在连接电脑…",
  confirmOnComputer: "请在电脑上点击「允许」。",
  connecting: "正在连接 {name}…",
  handshaking: "正在建立加密连接…",
  computer: "电脑",
  otherComputers: "选择其他电脑",
  retry: "重试",
  back: "返回",
  reconnect: "重新连接",
  disconnected: "与 {name} 的连接已断开。",
  forget: "移除",
  forgetConfirm: "在这部手机上移除“{name}”？之后需要重新扫码配对。",
  emptyList:
    "还没有配对的电脑。在电脑上打开 Pine 设置 → 远程控制，点击「配对新手机」，然后用相机扫码。",
  lastConnected: "上次连接 {date}",
  expired: "二维码已过期。请在电脑上重新生成。",
  invalid: "这不是有效的 Pine 配对二维码。",
  network: "无法连接到信令服务，请检查网络后重试。",
  offline:
    "{name} 没有响应。请确认电脑上的 Pine 正在运行，并已开启手机远程控制。",
  declined: "电脑上拒绝了这次配对。",
  unavailable: "电脑暂时无法接受连接。请确认电脑上的 Pine 已开启浏览器访问。",
  failed: "无法与电脑建立连接。请稍后重试。",
};

const en: typeof zh = {
  title: "Pine Remote",
  unsupported:
    "This browser cannot use Remote Control. Use a recent Safari or Chrome.",
  pairing: "Reaching your computer…",
  confirmOnComputer: "Click Allow on your computer.",
  connecting: "Connecting to {name}…",
  handshaking: "Setting up an encrypted connection…",
  computer: "Computer",
  otherComputers: "Choose another computer",
  retry: "Try again",
  back: "Back",
  reconnect: "Reconnect",
  disconnected: "The connection to {name} was lost.",
  forget: "Remove",
  forgetConfirm:
    "Remove “{name}” from this phone? You will need to scan a new code to pair again.",
  emptyList:
    "No computers are paired yet. On your computer, open Pine Settings → Remote Control, click Pair a phone, and scan the code with your camera.",
  lastConnected: "Last connected {date}",
  expired: "This code has expired. Create a new one on your computer.",
  invalid: "This is not a Pine pairing code.",
  network:
    "Cannot reach the signaling service. Check your network and try again.",
  offline:
    "{name} is not answering. Make sure Pine is running on it with phone remote control turned on.",
  declined: "The pairing was declined on the computer.",
  unavailable:
    "The computer cannot accept phones right now. Make sure browser access is on in Pine.",
  failed: "Could not connect to the computer. Try again later.",
};

export type StringKey = keyof typeof zh;

export const isChinese = /^zh\b/i.test(navigator.language);
const strings = isChinese ? zh : en;

export function t(key: StringKey, values: Record<string, string> = {}): string {
  return strings[key].replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? "",
  );
}
