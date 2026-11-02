import {
  ReplayGuard,
  SignalingRoom,
  createAnswer,
  createPairing,
  decodeFrame,
  deriveRoomId,
  encodeFrame,
  fingerprint,
  fromBase64Url,
  pairingUrl,
  randomBytes,
  toBase64Url,
  verifyOffer,
  type Fetch,
  type IceServer,
  type OfferEnvelope,
  type OfferResult,
} from "@pine/rc-protocol";
import type { RemoteStatus } from "../../shared/remoteControl";
import {
  nodePeer,
  type ChannelHandle,
  type PeerFactory,
  type PeerHandle,
} from "./peer";
import type { RemoteControlStore } from "./rcStore";
import { Tunnel } from "./tunnel";

/** Used when the signaling service has no relay to offer. */
const FALLBACK_ICE: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
const CONNECT_TIMEOUT_MS = 30_000;
const GATHER_TIMEOUT_MS = 8_000;

export interface PairingRequest {
  /** Fingerprint of the phone's key, for the person to recognise. */
  fingerprint: string;
}

export interface RemoteHostOptions {
  store: RemoteControlStore;
  fetch: Fetch;
  /** The local web server's origin and cookie, or nothing while it is off. */
  web: () => { origin: string; cookie: () => string | undefined } | undefined;
  /** Where phones open the Pine page, such as https://rc.aldine.cn. */
  pageOrigin: string;
  /** Asks the person at this computer whether a new phone may pair. */
  approve: (request: PairingRequest) => Promise<boolean>;
  createPeer?: PeerFactory;
  now?: () => number;
  /** Called whenever what the settings page shows has changed. */
  onChange?(): void;
  backoff?: (attempt: number) => number;
  gatherTimeoutMs?: number;
  connectTimeoutMs?: number;
}

interface Pairing {
  secret: Uint8Array;
  room: SignalingRoom;
  expiresAt: number;
  url: string;
  timer: ReturnType<typeof setTimeout>;
  /** A phone is waiting for the person to approve it. */
  busy: boolean;
}

interface Connection {
  peer: PeerHandle;
  channel?: ChannelHandle;
  tunnel?: Tunnel;
  timer: ReturnType<typeof setTimeout>;
  closed: boolean;
}

type RoomKind = { kind: "pairing" } | { kind: "device"; deviceId: string };

/**
 * Lets paired phones reach this computer's local web server without port
 * forwarding. It listens in each phone's room (and in the QR code's room while
 * pairing), checks every offer against the keys it knows, and for a verified
 * one builds a WebRTC connection whose DataChannel feeds the tunnel.
 */
export class RemoteHost {
  private readonly deviceRooms = new Map<string, SignalingRoom>();
  private readonly connections = new Map<string, Connection>();
  private readonly replay = new ReplayGuard();
  private pairing: Pairing | undefined;
  private stopped = true;
  private hostFingerprintCache: string | undefined;

  constructor(private readonly options: RemoteHostOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private changed(): void {
    this.options.onChange?.();
  }

  /** Starts listening for paired phones if Remote Control is on. */
  async start(): Promise<void> {
    this.stopped = false;
    if (this.options.store.enabled) await this.syncRooms();
  }

  async enable(): Promise<void> {
    await this.options.store.setEnabled(true);
    await this.start();
    this.changed();
  }

  async disable(): Promise<void> {
    await this.options.store.setEnabled(false);
    this.stop();
    this.changed();
  }

  /** Closes every connection and room; the app is quitting or it was turned off. */
  stop(): void {
    this.stopped = true;
    this.cancelPairing();
    for (const room of this.deviceRooms.values()) room.stop();
    this.deviceRooms.clear();
    for (const id of [...this.connections.keys()]) this.drop(id);
  }

  status(): RemoteStatus {
    return {
      enabled: this.options.store.enabled,
      ...(this.pairing
        ? {
            pairing: {
              url: this.pairing.url,
              expiresAt: this.pairing.expiresAt,
              fingerprint: this.hostFingerprintCache ?? "",
            },
          }
        : {}),
      devices: this.options.store.devices().map((device) => ({
        id: device.id,
        name: device.name,
        pairedAt: device.pairedAt,
        ...(device.lastSeenAt === undefined
          ? {}
          : { lastSeenAt: device.lastSeenAt }),
        online: Boolean(this.connections.get(device.id)?.channel),
      })),
      webAccessOn: this.options.web() !== undefined,
    };
  }

  /** Shows a QR code that one phone can scan within a few minutes. */
  async startPairing(): Promise<void> {
    if (!this.options.store.enabled || this.stopped)
      throw new Error("Turn Remote Control on first.");
    this.cancelPairing();
    const identity = await this.options.store.hostIdentity();
    this.hostFingerprintCache = await fingerprint(identity.publicKey);
    const offer = createPairing(
      identity.publicKey,
      this.options.store.signaling,
      this.now(),
    );
    const secret = fromBase64Url(offer.secret);
    const room = this.openRoom(
      this.options.store.signaling,
      await deriveRoomId(secret, "pairing"),
      { kind: "pairing" },
    );
    this.pairing = {
      secret,
      room,
      expiresAt: offer.expiresAt,
      url: pairingUrl(this.options.pageOrigin, offer),
      timer: setTimeout(
        () => this.cancelPairing(),
        offer.expiresAt - this.now(),
      ),
      busy: false,
    };
    this.pairing.timer.unref?.();
    room.start();
    this.changed();
  }

  cancelPairing(): void {
    if (!this.pairing) return;
    clearTimeout(this.pairing.timer);
    this.pairing.room.stop();
    this.pairing = undefined;
    this.changed();
  }

  async renameDevice(id: string, name: string): Promise<void> {
    await this.options.store.rename(id, name);
    this.changed();
  }

  async removeDevice(id: string): Promise<void> {
    await this.options.store.removeDevice(id);
    this.drop(id);
    await this.syncRooms();
    this.changed();
  }

  /** Keeps one open room per paired phone, and no others. */
  private async syncRooms(): Promise<void> {
    if (this.stopped) return;
    const wanted = new Set(this.options.store.devices().map((d) => d.id));
    for (const [id, room] of this.deviceRooms)
      if (!wanted.has(id)) {
        room.stop();
        this.deviceRooms.delete(id);
      }
    for (const id of wanted) {
      if (this.deviceRooms.has(id)) continue;
      const secret = this.options.store.roomSecret(id);
      if (!secret) continue;
      const room = this.openRoom(
        this.options.store.signaling,
        await deriveRoomId(secret, "device"),
        { kind: "device", deviceId: id },
      );
      this.deviceRooms.set(id, room);
      room.start();
    }
  }

  private openRoom(
    origin: string,
    room: string,
    context: RoomKind,
  ): SignalingRoom {
    const signaling: SignalingRoom = new SignalingRoom({
      origin,
      room,
      role: "host",
      fetch: this.options.fetch,
      backoff: this.options.backoff,
      onMessage: (message) => {
        if (message.type === "offer")
          void this.onOffer(signaling, context, message.offer).catch(
            () => undefined,
          );
      },
    });
    return signaling;
  }

  private async onOffer(
    room: SignalingRoom,
    context: RoomKind,
    raw: unknown,
  ): Promise<void> {
    if (this.stopped) return;
    const identity = await this.options.store.hostIdentity();
    const now = this.now();
    const pairing = context.kind === "pairing" ? this.pairing : undefined;
    if (context.kind === "pairing" && (!pairing || pairing.busy)) return;
    const result: OfferResult = await verifyOffer(raw, {
      hostKey: identity.publicKey,
      now,
      isKnownClient: (key) => this.options.store.isKnown(key),
      pairingSecret: pairing?.secret,
    });
    // Anything that fails is dropped without an answer, so a stranger learns nothing.
    if (!result.ok) return;
    const offer = raw as OfferEnvelope;
    if (!this.replay.accept(offer.session, now)) return;
    if ((context.kind === "pairing") !== (result.kind === "pairing")) return;
    if (
      context.kind === "device" &&
      toBase64Url(result.clientKey) !== context.deviceId
    )
      return;

    const web = this.options.web();
    if (!web) {
      await room
        .send({ type: "unavailable", session: offer.session })
        .catch(() => undefined);
      return;
    }
    if (result.kind === "pairing" && pairing) {
      pairing.busy = true;
      let allowed = false;
      try {
        allowed = await this.options.approve({
          fingerprint: await fingerprint(result.clientKey),
        });
      } finally {
        pairing.busy = false;
      }
      if (!allowed || this.pairing !== pairing) {
        await room
          .send({ type: "declined", session: offer.session })
          .catch(() => undefined);
        return;
      }
    }

    const deviceId = toBase64Url(result.clientKey);
    this.drop(deviceId);
    const ice = (await room.turn()) ?? FALLBACK_ICE;
    let peer;
    try {
      peer = await (this.options.createPeer ?? nodePeer)(ice);
    } catch {
      // The WebRTC library is missing or will not load on this computer.
      await room
        .send({ type: "unavailable", session: offer.session })
        .catch(() => undefined);
      return;
    }
    const connection: Connection = {
      peer,
      closed: false,
      timer: setTimeout(
        () => this.drop(deviceId),
        this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
      ),
    };
    connection.timer.unref?.();
    this.connections.set(deviceId, connection);
    peer.onState((state) => {
      if (state === "closed") this.drop(deviceId, connection);
    });
    peer.onChannel((channel) =>
      this.attach(deviceId, connection, channel, web, result, now),
    );
    try {
      const sdp = await peer.answer(
        offer.sdp,
        this.options.gatherTimeoutMs ?? GATHER_TIMEOUT_MS,
      );
      await room.send({
        type: "answer",
        answer: await createAnswer({ identity, offer, sdp, now: this.now() }),
      });
    } catch {
      this.drop(deviceId, connection);
    }
  }

  private attach(
    deviceId: string,
    connection: Connection,
    channel: ChannelHandle,
    web: NonNullable<ReturnType<RemoteHostOptions["web"]>>,
    result: Extract<OfferResult, { ok: true }>,
    now: number,
  ): void {
    if (connection.channel || connection.closed) {
      channel.close();
      return;
    }
    connection.channel = channel;
    const tunnel = new Tunnel(channel, {
      origin: web.origin,
      cookie: web.cookie,
    });
    connection.tunnel = tunnel;
    // A channel the phone created may already be open when it is announced.
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      clearTimeout(connection.timer);
      void this.opened(deviceId, connection, channel, result, now);
    };
    channel.onOpen(start);
    if (channel.isOpen()) start();
    channel.onMessage((bytes) => {
      let frame;
      try {
        frame = decodeFrame(bytes);
      } catch {
        this.drop(deviceId, connection);
        return;
      }
      if (frame.type !== "control") tunnel.handle(frame);
    });
    channel.onClosed(() => this.drop(deviceId, connection));
  }

  /** A new phone is paired only once the channel is up and it has its secret. */
  private async opened(
    deviceId: string,
    connection: Connection,
    channel: ChannelHandle,
    result: Extract<OfferResult, { ok: true }>,
    now: number,
  ): Promise<void> {
    try {
      if (result.kind === "pairing") {
        const roomSecret = randomBytes(32);
        channel.send(
          encodeFrame({
            type: "control",
            stream: 0,
            message: { type: "paired", roomSecret: toBase64Url(roomSecret) },
          }),
        );
        await this.options.store.addDevice(
          result.clientKey,
          "Phone",
          roomSecret,
          now,
        );
        this.cancelPairing();
        await this.syncRooms();
      } else {
        await this.options.store.touch(deviceId, this.now());
      }
      this.changed();
    } catch {
      this.drop(deviceId, connection);
    }
  }

  private drop(deviceId: string, only?: Connection): void {
    const connection = this.connections.get(deviceId);
    if (!connection || (only && connection !== only)) return;
    this.connections.delete(deviceId);
    connection.closed = true;
    clearTimeout(connection.timer);
    connection.tunnel?.close();
    connection.channel?.close();
    connection.peer.close();
    this.changed();
  }
}
