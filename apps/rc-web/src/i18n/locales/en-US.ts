import type zhCN from "./zh-CN";

export default {
  title: "Pine Remote",
  unsupported:
    "This browser cannot use Remote Control. Use a recent Safari or Chrome.",
  starting: "Starting…",
  pairing: "Reaching your computer…",
  confirmOnComputer: "Click Allow on your computer.",
  connecting: "Connecting to {name}…",
  handshaking: "Setting up an encrypted connection…",
  computer: "Computer",
  device: "Device",
  otherComputers: "Choose another computer",
  retry: "Try again",
  back: "Back",
  reconnect: "Reconnect",
  disconnected: "The connection to {name} was lost.",
  forget: "Remove",
  forgetTitle: "Remove “{name}”?",
  forgetDescription:
    "This device will no longer be able to reach it until you pair again.",
  cancel: "Cancel",
  emptyList:
    "No computers are paired yet. On your computer, open Pine Settings → Remote Control, click Pair a device, and scan the code or open the pairing link.",
  lastConnected: "Last connected {date}",
  expired: "This code has expired. Create a new one on your computer.",
  invalid: "This is not a Pine pairing link.",
  network:
    "Cannot reach the signaling service. Check your network and try again.",
  offline:
    "{name} is not answering. Make sure Pine is running on it with Remote control via Aldine turned on.",
  declined: "The pairing was declined on the computer.",
  unavailable:
    "The computer cannot accept devices right now. Make sure browser access is on in Pine.",
  failed: "Could not connect to the computer. Try again later.",
} satisfies typeof zhCN;
