import path from "node:path";
import { renderUnicodeCompact } from "uqr";
import { RemoteControlStore, type PairedDevice } from "../main/remote/rcStore";
import type { RemoteAction } from "./options";

/** Where the core keeps Remote Control's state, under the data directory. */
export function remoteStorePath(dataDirectory: string): string {
  return path.join(dataDirectory, "agent", "remote-control.json");
}

function when(timestamp: number | undefined): string {
  return timestamp === undefined ? "never" : new Date(timestamp).toISOString();
}

export function formatDevices(devices: readonly PairedDevice[]): string {
  if (devices.length === 0) return "No devices are paired.";
  return devices
    .map(
      (device) =>
        `${device.id}\n  ${device.name}, paired ${when(device.pairedAt)}, last seen ${when(device.lastSeenAt)}`,
    )
    .join("\n");
}

/** The text to show the person at the terminal who is adding a device. */
export function formatPairing(pairing: {
  url: string;
  expiresAt: number;
  fingerprint: string;
}): string {
  const qr = renderUnicodeCompact(pairing.url, { border: 2 });
  return [
    "Scan this with the device's camera, or open the link in its browser:",
    "",
    qr,
    pairing.url,
    "",
    `This computer's fingerprint: ${pairing.fingerprint}`,
    `Valid until ${new Date(pairing.expiresAt).toLocaleTimeString()}. The link is a secret; do not share it.`,
  ].join("\n");
}

/**
 * Lists or removes paired devices straight from the state file. A running
 * server keeps its own copy, so it has to be stopped first.
 */
export async function runRemoteAction(
  dataDirectory: string,
  action: RemoteAction,
): Promise<string> {
  const store = new RemoteControlStore(remoteStorePath(dataDirectory));
  await store.load();
  if (action.kind === "list") return formatDevices(store.devices());
  // A unique start of the id is enough; the full ids are long.
  const matches = store
    .devices()
    .filter((device) => device.id.startsWith(action.id));
  if (matches.length === 0) throw new Error(`No paired device "${action.id}".`);
  if (matches.length > 1)
    throw new Error(`"${action.id}" matches more than one device.`);
  const [device] = matches as [PairedDevice];
  await store.removeDevice(device.id);
  return `Removed ${device.name}. It can no longer connect.`;
}
