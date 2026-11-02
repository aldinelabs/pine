import nodeDataChannel from "node-datachannel";
import {
  SignalingRoom,
  createOffer,
  decodeFrame,
  encodeFrame,
  verifyAnswer,
  type Frame,
  type Identity,
} from "@pine/rc-protocol";

/**
 * A phone, played by a second WebRTC stack in the same process. It does what
 * the Pine page will do: wait for its room, send a signed offer with all
 * candidates in it, verify the signed answer, and then speak frames.
 */
export async function connectPhone(options: {
  origin: string;
  room: string;
  identity: Identity;
  hostKey: Uint8Array;
  pairingSecret?: Uint8Array;
  /** Waits for an answer this long before giving up. */
  timeoutMs?: number;
}) {
  const frames: Frame[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const signaling = new SignalingRoom({
    origin: options.origin,
    room: options.room,
    role: "client",
    fetch,
    onMessage: (message) => messages.push(message),
  });
  let open = false;
  signaling.start();
  const peer = new nodeDataChannel.PeerConnection("phone", { iceServers: [] });
  // Candidates can finish gathering inside createDataChannel, so listen first.
  const gathered = new Promise<void>((resolve) =>
    peer.onGatheringStateChange((state) => state === "complete" && resolve()),
  );
  const channel = peer.createDataChannel("pine-rc");
  channel.onOpen(() => {
    open = true;
  });
  channel.onMessage((message) => {
    if (typeof message === "string") return;
    frames.push(decodeFrame(new Uint8Array(message as Buffer)));
  });
  await gathered;
  const offer = await createOffer({
    identity: options.identity,
    hostKey: options.hostKey,
    sdp: peer.localDescription()!.sdp,
    now: Date.now(),
    pairingSecret: options.pairingSecret,
  });
  // Give the event stream a moment to attach before the host answers.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await signaling.send({ type: "offer", offer });

  await until(
    () =>
      messages.some((m) =>
        ["answer", "declined", "unavailable"].includes(String(m.type)),
      ),
    options.timeoutMs ?? 5000,
  );
  const answerMessage = messages.find((m) => m.type === "answer");
  const answered = answerMessage !== undefined;
  let verified = false;
  if (answerMessage) {
    const result = await verifyAnswer(answerMessage.answer, {
      offer,
      now: Date.now(),
    });
    verified = result.ok;
    if (result.ok)
      peer.setRemoteDescription(
        (answerMessage.answer as { sdp: string }).sdp,
        "answer",
      );
  }
  return {
    frames,
    messages,
    answered,
    verified,
    isOpen: () => open,
    async waitOpen(timeoutMs = 8000) {
      return until(() => open, timeoutMs);
    },
    send: (frame: Frame) => channel.sendMessageBinary(encodeFrame(frame)),
    close() {
      signaling.stop();
      channel.close();
      peer.close();
    },
  };
}

export async function until(check: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}
