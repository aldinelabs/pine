// Wire types ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.
//
// Every field is optional because nothing says which ones the server always
// sends. Fields the protocol calls "bytes" are base64 strings.

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
  TOOL_CALL_START: 11,
  TOOL_CALL_RESULT: 12,
} as const;

/** `media_type` of `getuploadurl`. */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

/** `status` of `sendtyping`. */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

/** Sent with every authenticated request. */
export interface BaseInfo {
  channel_version?: string;
  /** Who the client says it is. The server only records it. */
  bot_agent?: string;
}

export interface TextItem {
  text?: string;
}

/** Where an encrypted file sits on the CDN, and the key that opens it. */
export interface CDNMedia {
  encrypt_query_param?: string;
  /** Base64 of the 16 key bytes, or base64 of their 32 hex characters. */
  aes_key?: string;
  /** 0 = only the file id is encrypted, 1 = thumbnail data is packed in. */
  encrypt_type?: number;
  /** A complete download URL. Preferred over `encrypt_query_param`. */
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  /** The key as 32 hex characters. Preferred over `media.aes_key`. */
  aeskey?: string;
  url?: string;
  /** Size of the ciphertext, set on images the bot sends. */
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  /** 1 pcm, 2 adpcm, 3 feature, 4 speex, 5 amr, 6 silk, 7 mp3, 8 ogg-speex. */
  encode_type?: number;
  bits_per_sample?: number;
  /** Hz. */
  sample_rate?: number;
  /** Milliseconds. */
  playtime?: number;
  /** The server's transcript of the recording. */
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  /** Size of the plain file in bytes, as a decimal string. */
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

/** The part of a quoted message the user selected. */
export interface PartialText {
  start: string;
  end: string;
  startindex: number;
  endindex: number;
  quotemd5: string;
}

/** A message the user quoted. */
export interface RefMessage {
  /** The quoted content. Newer WeChat clients leave it out. */
  message_item?: MessageItem;
  /** A short summary of the quoted message. */
  title?: string;
  /** The server id of the quoted message, a decimal string. */
  svr_id?: string;
  partial_text?: PartialText;
}

export interface ToolCallStartItem {
  tool_name?: string;
  tool_call_id?: string;
}

export interface ToolCallResultItem {
  tool_name?: string;
  tool_call_id?: string;
  status?: string;
}

export interface MessageItem {
  /** One of `MessageItemType`. */
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  /** A decimal string: the number on the wire does not fit a double. */
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  tool_call_start_item?: ToolCallStartItem;
  tool_call_result_item?: ToolCallResultItem;
}

export interface WeixinMessage {
  seq?: number;
  /** A decimal string: the number on the wire does not fit a double. */
  message_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  /** One of `MessageType`. */
  message_type?: number;
  /** One of `MessageState`. */
  message_state?: number;
  item_list?: MessageItem[];
  /** Has to be sent back with every reply to this message. */
  context_token?: string;
  run_id?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  /** The cursor for the next request. Opaque. */
  get_updates_buf?: string;
  /** The timeout the server wants the client to use for the next poll. */
  longpolling_timeout_ms?: number;
}

export interface SendMessageResp {
  ret?: number;
  errmsg?: string;
  /** A decimal string: the number on the wire does not fit a double. */
  message_id?: string;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface GetUploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
  /** A complete upload URL. Preferred over `upload_param`. */
  upload_full_url?: string;
}

/** The answer of `sendtyping`, `notifystart` and `notifystop`. */
export interface StatusResp {
  ret?: number;
  errmsg?: string;
}

export interface QrCodeResp {
  /** The id the status poll asks about. */
  qrcode?: string;
  /** The text to draw as a QR code. Not an image. */
  qrcode_img_content?: string;
}

export interface QrStatusResp {
  /**
   * `wait`, `scaned`, `confirmed`, `expired`, `scaned_but_redirect`,
   * `need_verifycode`, `verify_code_blocked` or `binded_redirect`.
   */
  status?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  /** The API host of the account. Empty means the default one. */
  baseurl?: string;
  /** The WeChat user who scanned the code. */
  ilink_user_id?: string;
  /** A host name without a scheme, sent with `scaned_but_redirect`. */
  redirect_host?: string;
}
