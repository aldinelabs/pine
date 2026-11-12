import { STALE_TOKEN_CODE } from "./constants";

// Messages of these errors end up in logs and on screen. They name the
// operation and the host, never a token, a request body or a query string.

/** The server answered, and the answer carries a non-zero `ret` or `errcode`. */
export class IlinkApiError extends Error {
  readonly ret?: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  /** The bot token is no longer accepted; the account has to be scanned again. */
  readonly staleToken: boolean;

  constructor(
    label: string,
    response: { ret?: number; errcode?: number; errmsg?: string },
  ) {
    const codes = [
      response.ret === undefined ? undefined : `ret=${response.ret}`,
      response.errcode === undefined
        ? undefined
        : `errcode=${response.errcode}`,
    ].filter((part) => part !== undefined);
    super(`${label} failed${codes.length > 0 ? ` (${codes.join(", ")})` : ""}`);
    this.name = "IlinkApiError";
    this.ret = response.ret;
    this.errcode = response.errcode;
    this.errmsg = response.errmsg;
    this.staleToken =
      response.ret === STALE_TOKEN_CODE ||
      response.errcode === STALE_TOKEN_CODE;
  }
}

/** The server answered with an HTTP status outside 2xx. */
export class IlinkHttpError extends Error {
  readonly status: number;

  constructor(label: string, status: number) {
    super(`${label} failed with HTTP ${status}`);
    this.name = "IlinkHttpError";
    this.status = status;
  }
}

/** The client gave up waiting for the answer. */
export class IlinkTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IlinkTimeoutError";
  }
}

/** A URL was not allowed, or the server tried to send the request elsewhere. */
export class IlinkUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IlinkUrlError";
  }
}

/** A 2xx answer whose body is not the JSON the protocol promises. */
export class IlinkResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IlinkResponseError";
  }
}
