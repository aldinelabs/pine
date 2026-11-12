import type { Fetch, UrlPurpose } from "@pine/wechat-ilink";
import type { ChannelFactory } from "./channel";

export interface ClawBotChannelOptions {
  fetch: Fetch;
  /** Pine's version, declared to the iLink server. */
  version: string;
  /** Tests point these at the mock iLink server. */
  apiBaseUrl?: string;
  cdnBaseUrl?: string;
  /** Default: the package's `defaultAllowUrl`. */
  allowUrl?: (url: URL, purpose: UrlPurpose) => boolean;
}

/** WeChat through Tencent's ClawBot (iLink). Not implemented yet. */
export function createClawBotChannels(
  options: ClawBotChannelOptions,
): ChannelFactory {
  void options;
  throw new Error("not implemented");
}
