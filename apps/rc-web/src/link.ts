import {
  GatherWatch,
  SignalingRoom,
  createOffer,
  wantedCandidate,
  verifyAnswer,
  type IceServer,
  type Identity,
  type OfferEnvelope,
} from "@pine/rc-protocol";
import { TunnelClient } from "./tunnelClient";

const FALLBACK_ICE: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
const SIGNALING_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 20_000;
const PING_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 45_000;
/** Pauses sending above this much unsent data. */
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;

export type LinkFailure =
  /** The signaling service could not be reached. */
  | "network"
  /** The computer is not listening: Pine is closed or Remote Control is off. */
  | "offline"
  /** The person at the computer said no. */
  | "declined"
  /** The computer cannot accept phones right now. */
  | "unavailable"
  /** The devices could not reach each other. */
  | "failed";

export class LinkError extends Error {
  constructor(readonly reason: LinkFailure) {
    super(reason);
  }
}

export type LinkStage = "signaling" | "waiting" | "connecting";

export interface LinkOptions {
  signaling: string;
  room: string;
  identity: Identity;
  hostKey: Uint8Array;
  /** Only when pairing from a QR code. */
  pairingSecret?: Uint8Array;
  /** How long the computer may take to answer, such as while someone decides. */
  answerTimeoutMs: number;
  onControl(message: Record<string, unknown>): void;
  onClose(): void;
  onStage?(stage: LinkStage): void;
}

export interface Link {
  tunnel: TunnelClient;
  close(): void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, failure: LinkFailure) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LinkError(failure)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** All candidates go in the one offer, so signaling is one round trip. */
function watchGathering(
  peer: RTCPeerConnection,
  servers: IceServer[],
): GatherWatch {
  const watch = new GatherWatch(wantedCandidate(servers));
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) watch.candidate(event.candidate.candidate);
    else watch.complete();
  });
  peer.addEventListener("icegatheringstatechange", () => {
    if (peer.iceGatheringState === "complete") watch.complete();
  });
  return watch;
}

/**
 * Reaches the desktop: meets it in a signaling room, sends an offer signed
 * with this phone's key, checks the desktop's signed answer against the key
 * the QR code gave, and opens one DataChannel for the tunnel.
 */
export async function connect(options: LinkOptions): Promise<Link> {
  const messages: Array<Record<string, unknown>> = [];
  let onMessage = () => undefined as void;
  let signalingOpen: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    signalingOpen = resolve;
  });
  const room = new SignalingRoom({
    origin: options.signaling,
    room: options.room,
    role: "client",
    fetch: (url, init) => fetch(url, init),
    onMessage: (message) => {
      messages.push(message);
      onMessage();
    },
    onState: (state) => state === "open" && signalingOpen(),
  });
  let peer: RTCPeerConnection | undefined;
  try {
    options.onStage?.("signaling");
    room.start();
    await withTimeout(opened, SIGNALING_TIMEOUT_MS, "network");

    const iceServers = (await room.turn()) ?? FALLBACK_ICE;
    peer = new RTCPeerConnection({ iceServers });
    const channel = peer.createDataChannel("pine-rc");
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    const gathering = watchGathering(peer, iceServers);
    await peer.setLocalDescription(await peer.createOffer());
    await gathering.ready;

    const offer: OfferEnvelope = await createOffer({
      identity: options.identity,
      hostKey: options.hostKey,
      sdp: peer.localDescription!.sdp,
      now: Date.now(),
      pairingSecret: options.pairingSecret,
    });
    const sent = await room.send({ type: "offer", offer }).catch(() => {
      throw new LinkError("network");
    });
    if (!sent.delivered) throw new LinkError("offline");
    options.onStage?.("waiting");

    const reply = await withTimeout(
      new Promise<Record<string, unknown>>((resolve) => {
        const check = () => {
          const found = messages.find(
            (message) =>
              (message.type === "answer" &&
                (message.answer as { session?: unknown } | undefined)
                  ?.session === offer.session) ||
              ((message.type === "declined" ||
                message.type === "unavailable") &&
                message.session === offer.session),
          );
          if (found) resolve(found);
        };
        onMessage = check;
        check();
      }),
      options.answerTimeoutMs,
      "offline",
    );
    if (reply.type === "declined") throw new LinkError("declined");
    if (reply.type === "unavailable") throw new LinkError("unavailable");
    const verified = await verifyAnswer(reply.answer, {
      offer,
      now: Date.now(),
    });
    if (!verified.ok) throw new LinkError("failed");
    options.onStage?.("connecting");
    await peer.setRemoteDescription({
      type: "answer",
      sdp: (reply.answer as { sdp: string }).sdp,
    });
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        if (channel.readyState === "open") return resolve();
        channel.addEventListener("open", () => resolve(), { once: true });
        channel.addEventListener(
          "close",
          () => reject(new LinkError("failed")),
          {
            once: true,
          },
        );
      }),
      OPEN_TIMEOUT_MS,
      "failed",
    );
    room.stop();
    return attach(peer, channel, options);
  } catch (error) {
    room.stop();
    peer?.close();
    throw error instanceof LinkError ? error : new LinkError("failed");
  }
}

function attach(
  peer: RTCPeerConnection,
  channel: RTCDataChannel,
  options: LinkOptions,
): Link {
  let closed = false;
  let lastHeard = Date.now();
  const tunnel = new TunnelClient(
    {
      send: (bytes) => channel.send(bytes as Uint8Array<ArrayBuffer>),
      drained: () =>
        channel.bufferedAmount <= BUFFER_HIGH
          ? Promise.resolve()
          : new Promise((resolve) => {
              const done = () => {
                channel.removeEventListener("bufferedamountlow", done);
                channel.removeEventListener("close", done);
                resolve();
              };
              channel.addEventListener("bufferedamountlow", done);
              channel.addEventListener("close", done);
            }),
    },
    options.onControl,
  );
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(pinger);
    tunnel.close();
    channel.close();
    peer.close();
    options.onClose();
  };
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    lastHeard = Date.now();
    if (event.data instanceof ArrayBuffer)
      tunnel.receive(new Uint8Array(event.data));
  });
  channel.addEventListener("close", close);
  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed")
      close();
  });
  // A phone that slept or lost its network stops hearing pongs.
  const pinger = setInterval(() => {
    if (Date.now() - lastHeard > PING_TIMEOUT_MS) return close();
    try {
      tunnel.send({ type: "ping", stream: 0 });
    } catch {
      close();
    }
  }, PING_INTERVAL_MS);
  return { tunnel, close };
}
