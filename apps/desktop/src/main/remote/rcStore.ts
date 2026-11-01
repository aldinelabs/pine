import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  exportIdentity,
  fingerprint,
  fromBase64Url,
  generateIdentity,
  importIdentity,
  toBase64Url,
  type Identity,
} from "@pine/rc-protocol";
import { z } from "zod";

/** The service that introduces phones to this computer. */
export const DEFAULT_SIGNALING_ORIGIN = "https://api.aldine.cn";
const MAX_DEVICES = 20;

const deviceSchema = z.object({
  /** The phone's public key, base64url. It is also the device's id. */
  id: z.string().min(1),
  name: z.string().max(100),
  /** Secret the phone and this computer derive the device's room from. */
  roomSecret: z.string().min(1),
  pairedAt: z.number(),
  lastSeenAt: z.number().optional(),
});

const storedSchema = z.object({
  enabled: z.boolean().default(false),
  signaling: z.string().default(DEFAULT_SIGNALING_ORIGIN),
  identity: z
    .object({ publicKey: z.string().min(1), privateKey: z.string().min(1) })
    .optional(),
  devices: z.array(deviceSchema).default([]),
});
type Stored = z.infer<typeof storedSchema>;

export type PairedDevice = z.infer<typeof deviceSchema>;

/**
 * Remote Control's state on this computer: whether it is on, this computer's
 * long-term key, and the phones paired with it. The private key and each
 * phone's room secret sit in a file only the user can read, as the browser
 * access password does.
 */
export class RemoteControlStore {
  private stored: Stored = storedSchema.parse({});
  private identity: Identity | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.stored = storedSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
    } catch {
      this.stored = storedSchema.parse({});
    }
  }

  get enabled(): boolean {
    return this.stored.enabled;
  }

  get signaling(): string {
    return this.stored.signaling;
  }

  devices(): PairedDevice[] {
    return this.stored.devices.map((device) => ({ ...device }));
  }

  /** This computer's key, made on first use. */
  async hostIdentity(): Promise<Identity> {
    if (this.identity) return this.identity;
    if (this.stored.identity) {
      try {
        this.identity = await importIdentity(this.stored.identity, true);
        return this.identity;
      } catch {
        // An unreadable key is replaced; every phone must pair again.
        await this.update((stored) => ({ ...stored, devices: [] }));
      }
    }
    const identity = await generateIdentity(true);
    this.identity = identity;
    const exported = await exportIdentity(identity);
    await this.update((stored) => ({ ...stored, identity: exported }));
    return identity;
  }

  /** Short text to compare with what the phone shows. */
  async hostFingerprint(): Promise<string> {
    return fingerprint((await this.hostIdentity()).publicKey);
  }

  setEnabled(enabled: boolean): Promise<void> {
    return this.update((stored) => ({ ...stored, enabled }));
  }

  isKnown(publicKey: Uint8Array): boolean {
    const id = toBase64Url(publicKey);
    return this.stored.devices.some((device) => device.id === id);
  }

  device(id: string): PairedDevice | undefined {
    return this.stored.devices.find((device) => device.id === id);
  }

  /** A phone that is already paired is replaced, so pairing again resets it. */
  async addDevice(
    publicKey: Uint8Array,
    name: string,
    roomSecret: Uint8Array,
    now: number,
  ): Promise<PairedDevice> {
    const device: PairedDevice = {
      id: toBase64Url(publicKey),
      name: name.slice(0, 100),
      roomSecret: toBase64Url(roomSecret),
      pairedAt: now,
    };
    await this.update((stored) => {
      const others = stored.devices.filter((entry) => entry.id !== device.id);
      if (others.length >= MAX_DEVICES)
        throw new Error("Too many paired phones. Remove one first.");
      return { ...stored, devices: [...others, device] };
    });
    return device;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.update((stored) => ({
      ...stored,
      devices: stored.devices.map((device) =>
        device.id === id ? { ...device, name: name.slice(0, 100) } : device,
      ),
    }));
  }

  async touch(id: string, now: number): Promise<void> {
    await this.update((stored) => ({
      ...stored,
      devices: stored.devices.map((device) =>
        device.id === id ? { ...device, lastSeenAt: now } : device,
      ),
    }));
  }

  /** The phone can no longer connect; its room secret is forgotten. */
  async removeDevice(id: string): Promise<void> {
    await this.update((stored) => ({
      ...stored,
      devices: stored.devices.filter((device) => device.id !== id),
    }));
  }

  roomSecret(id: string): Uint8Array | undefined {
    const device = this.device(id);
    return device ? fromBase64Url(device.roomSecret) : undefined;
  }

  /** Changes are applied one after another and only kept once written. */
  private update(change: (stored: Stored) => Stored): Promise<void> {
    const run = async () => {
      const next = change(this.stored);
      await this.save(next);
      this.stored = next;
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async save(next: Stored): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }
}
