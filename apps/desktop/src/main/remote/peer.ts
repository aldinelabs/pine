import type { DataChannel } from "node-datachannel";
import type { IceServer } from "@pine/rc-protocol";

/**
 * Everything the Remote Control host needs from WebRTC. This file is the only
 * one that touches the native library, so the host can be tested with fakes.
 */
export interface ChannelHandle {
  readonly label: string;
  isOpen(): boolean;
  onOpen(handler: () => void): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  onClosed(handler: () => void): void;
  /** Throws once the channel cannot send. */
  send(bytes: Uint8Array): void;
  /** Resolves once the send buffer has emptied enough to send more. */
  drained(): Promise<void>;
  close(): void;
}

export interface PeerHandle {
  /**
   * Applies the phone's offer and resolves with the answer once this
   * computer's connection candidates are gathered, or after the timeout with
   * the ones found so far.
   */
  answer(offerSdp: string, timeoutMs: number): Promise<string>;
  onChannel(handler: (channel: ChannelHandle) => void): void;
  /** `closed` covers every way the connection can end. */
  onState(handler: (state: "connected" | "closed") => void): void;
  close(): void;
}

/**
 * Resolves with a connection, or rejects when the native library cannot be
 * loaded. It loads on first use, so a platform without its binary only loses
 * Remote Control instead of failing to start.
 */
export type PeerFactory = (iceServers: IceServer[]) => Promise<PeerHandle>;

const LOW_WATER_BYTES = 64 * 1024;

/** libdatachannel takes credentials inside the URL. */
export function iceUrls(servers: IceServer[]): string[] {
  return servers.flatMap((server) =>
    server.urls.map((url) => {
      const separator = url.indexOf(":");
      const scheme = url.slice(0, separator);
      if (
        (scheme !== "turn" && scheme !== "turns") ||
        !server.username ||
        !server.credential
      )
        return url;
      return `${scheme}:${encodeURIComponent(server.username)}:${encodeURIComponent(server.credential)}@${url.slice(separator + 1)}`;
    }),
  );
}

function wrapChannel(channel: DataChannel): ChannelHandle {
  const waiting: Array<() => void> = [];
  const release = () => {
    for (const resolve of waiting.splice(0)) resolve();
  };
  channel.setBufferedAmountLowThreshold(LOW_WATER_BYTES);
  channel.onBufferedAmountLow(release);
  channel.onClosed(release);
  return {
    label: channel.getLabel(),
    isOpen: () => channel.isOpen(),
    onOpen: (handler) => channel.onOpen(handler),
    onMessage: (handler) =>
      channel.onMessage((message) => {
        if (typeof message === "string") return;
        handler(
          message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : new Uint8Array(
                message.buffer,
                message.byteOffset,
                message.byteLength,
              ),
        );
      }),
    onClosed: (handler) => channel.onClosed(handler),
    send(bytes) {
      if (!channel.isOpen() || !channel.sendMessageBinary(bytes))
        throw new Error("The channel is closed.");
    },
    drained() {
      if (!channel.isOpen() || channel.bufferedAmount() <= LOW_WATER_BYTES)
        return Promise.resolve();
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => channel.close(),
  };
}

export const nodePeer: PeerFactory = async (iceServers) => {
  const { default: nodeDataChannel } = await import("node-datachannel");
  const connection = new nodeDataChannel.PeerConnection("pine-rc", {
    iceServers: iceUrls(iceServers),
  });
  return {
    answer(offerSdp, timeoutMs) {
      return new Promise<string>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          const description = connection.localDescription();
          if (description) resolve(description.sdp);
          else reject(new Error("No answer was produced."));
        };
        const timer = setTimeout(finish, timeoutMs);
        connection.onGatheringStateChange((state) => {
          if (state === "complete") finish();
        });
        connection.setRemoteDescription(offerSdp, "offer");
        // Gathering can finish inside the call above, before any event is heard.
        if (connection.gatheringState() === "complete") finish();
      });
    },
    onChannel: (handler) =>
      connection.onDataChannel((channel) => handler(wrapChannel(channel))),
    onState: (handler) =>
      connection.onStateChange((state) => {
        if (state === "connected") handler("connected");
        else if (
          state === "closed" ||
          state === "failed" ||
          state === "disconnected"
        )
          handler("closed");
      }),
    close: () => connection.close(),
  };
};
