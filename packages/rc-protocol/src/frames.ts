import { type Bytes, concatBytes, utf8 } from "./encoding";

/**
 * A DataChannel carries ordered messages, and browsers and libdatachannel
 * disagree on how big one may be, so every frame stays at or below 16 KiB.
 * A frame is one type byte, a four-byte stream id and a payload. A stream is
 * one HTTP exchange with the desktop's local web server; the phone opens
 * odd-numbered ones.
 */
export const MAX_FRAME_BYTES = 16 * 1024;
const HEADER_BYTES = 5;
export const MAX_DATA_BYTES = MAX_FRAME_BYTES - HEADER_BYTES;

const TYPES = {
  request: 1,
  response: 2,
  data: 3,
  end: 4,
  cancel: 5,
  ping: 6,
  pong: 7,
} as const;

export interface RequestHead {
  method: string;
  path: string;
  headers: Array<[string, string]>;
}

export interface ResponseHead {
  status: number;
  headers: Array<[string, string]>;
}

export type Frame =
  | { type: "request"; stream: number; head: RequestHead }
  | { type: "response"; stream: number; head: ResponseHead }
  | { type: "data"; stream: number; data: Uint8Array }
  | { type: "end" | "cancel" | "ping" | "pong"; stream: number };

export class FrameError extends Error {}

const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkHeaders(headers: unknown): Array<[string, string]> {
  if (!Array.isArray(headers)) throw new FrameError("Invalid headers.");
  for (const header of headers) {
    if (
      !Array.isArray(header) ||
      header.length !== 2 ||
      typeof header[0] !== "string" ||
      typeof header[1] !== "string" ||
      !HEADER_NAME.test(header[0]) ||
      CONTROL.test(header[1])
    )
      throw new FrameError("Invalid header.");
  }
  return headers as Array<[string, string]>;
}

function checkRequest(head: unknown): RequestHead {
  const value = head as Partial<RequestHead> | null;
  if (
    !value ||
    typeof value.method !== "string" ||
    !METHODS.has(value.method) ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    value.path.startsWith("//") ||
    CONTROL.test(value.path)
  )
    throw new FrameError("Invalid request.");
  return {
    method: value.method,
    path: value.path,
    headers: checkHeaders(value.headers),
  };
}

function checkResponse(head: unknown): ResponseHead {
  const value = head as Partial<ResponseHead> | null;
  if (
    !value ||
    !Number.isInteger(value.status) ||
    value.status! < 100 ||
    value.status! > 599
  )
    throw new FrameError("Invalid response.");
  return { status: value.status!, headers: checkHeaders(value.headers) };
}

export function encodeFrame(frame: Frame): Bytes {
  let payload: Uint8Array = new Uint8Array(0);
  if (frame.type === "request" || frame.type === "response")
    payload = utf8(JSON.stringify(frame.head));
  else if (frame.type === "data") payload = frame.data;
  if (payload.length > MAX_DATA_BYTES)
    throw new FrameError("The frame is too large.");
  const header = new Uint8Array(HEADER_BYTES);
  header[0] = TYPES[frame.type];
  new DataView(header.buffer).setUint32(1, frame.stream);
  return concatBytes(header, payload);
}

export function decodeFrame(bytes: Uint8Array): Frame {
  if (bytes.length < HEADER_BYTES || bytes.length > MAX_FRAME_BYTES)
    throw new FrameError("Invalid frame size.");
  const stream = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(1);
  const payload = bytes.subarray(HEADER_BYTES);
  switch (bytes[0]) {
    case TYPES.request:
    case TYPES.response: {
      let head: unknown;
      try {
        head = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        throw new FrameError("Invalid head.");
      }
      return bytes[0] === TYPES.request
        ? { type: "request", stream, head: checkRequest(head) }
        : { type: "response", stream, head: checkResponse(head) };
    }
    case TYPES.data:
      return { type: "data", stream, data: payload };
    case TYPES.end:
    case TYPES.cancel:
    case TYPES.ping:
    case TYPES.pong: {
      if (payload.length > 0) throw new FrameError("Unexpected payload.");
      const type = (Object.keys(TYPES) as Array<keyof typeof TYPES>).find(
        (key) => TYPES[key] === bytes[0],
      ) as "end" | "cancel" | "ping" | "pong";
      return { type, stream };
    }
    default:
      throw new FrameError("Unknown frame type.");
  }
}

/** Splits a body into data frames that each fit one DataChannel message. */
export function* dataFrames(
  stream: number,
  body: Uint8Array,
): Generator<Bytes> {
  for (let offset = 0; offset < body.length; offset += MAX_DATA_BYTES)
    yield encodeFrame({
      type: "data",
      stream,
      data: body.subarray(offset, offset + MAX_DATA_BYTES),
    });
}
