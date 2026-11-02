/**
 * Messages between the service worker and the page holding the connection.
 * Only types live here: the worker imports nothing at runtime, so it builds
 * as one classic script.
 */

/** The page tells the worker which embedded Pine it serves. */
export interface ShellHello {
  type: "pine-shell";
  token: string;
}

/** The worker asks the page to send one request to the computer. */
export interface BridgeRequest {
  type: "pine-request";
  method: string;
  path: string;
  headers: Array<[string, string]>;
  body?: ArrayBuffer;
}

/** The page's answer, on the request's own port. */
export type BridgeReply =
  | { type: "head"; status: number; headers: Array<[string, string]> }
  | { type: "data"; chunk: ArrayBuffer }
  | { type: "end" }
  | { type: "error"; status: number; message: string };

/** The worker's reader went away. */
export interface BridgeCancel {
  type: "cancel";
}

/** Where the computer's own web interface is embedded: /pine/<token>/. */
export const PINE_PREFIX = "/pine/";
