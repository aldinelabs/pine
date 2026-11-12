// Limits and timings of WeChat remote. Values marked "to be confirmed in
// phase 0" depend on Tencent's side and were not measured on a real account.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// Replies

/** Messages Tencent lets a bot send per inbound context token. To be confirmed in phase 0. */
export const BUDGET = 10;
/** Messages the bridge spends before it keeps the rest for the digest. */
export const USABLE = 8;
/** Pushes inside this window are merged into one message. */
export const MERGE_WINDOW_MS = 2 * SECOND;
/** Characters per WeChat message. To be confirmed in phase 0. */
export const REPLY_MAX = 1800;
/** Rows of a numbered list per page. */
export const PAGE_ROWS = 8;
/** Characters per list row. */
export const ROW_MAX = 70;
/** `.u 9`: the session of the latest push. */
export const PUSH_SLOT = 9;
/** A numbered list stays valid this long after it was delivered. */
export const HANDLE_TTL_MS = 30 * MINUTE;
/** A confirmation (`.y NN` for a D command) expires after this. */
export const CONFIRM_TTL_MS = 120 * SECOND;
/** Pages kept for `.more`. */
export const PAGER_TTL_MS = 10 * MINUTE;
/** At most one "paused" reply per this interval. */
export const PAUSED_NOTICE_INTERVAL_MS = 10 * MINUTE;
/** The same error reply is not repeated within this window. */
export const ERROR_REPEAT_MS = 30 * SECOND;

// Staleness and asks

/** A message older than this is held instead of executed. */
export const STALE_MS = 10 * MINUTE;
/** A message dated further ahead than this is treated as stale. */
export const FUTURE_SKEW_MS = 2 * MINUTE;
/** Held messages are dropped after this. */
export const HELD_TTL_MS = 10 * MINUTE;
/** A closed ask number answers "already handled" for this long. */
export const TOMBSTONE_TTL_MS = 30 * MINUTE;
/** Ask numbers never overlap list rows (1-8) or the push slot (9). */
export const ASK_MIN = 11;
export const ASK_MAX = 99;
/** Clock skew tolerated between WeChat's timestamp and the local clock. */
export const ASK_SKEW_MS = 5 * SECOND;
/** A bare `.y` needs this gap after the latest card. */
export const BARE_GAP_MS = 5 * SECOND;
/** `.y` without a number approves only a held batch. */
export const ALLOW_BARE_APPROVE = false;

// Text sizes

export const LAST_MAX_PAGES = 6;
export const CARD_SUBJECT_MAX = 300;
export const CARD_DESCRIPTION_MAX = 120;
export const SHOW_INPUT_MAX = 1500;
export const DONE_EXCERPT_MAX = 300;
export const HISTORY_ENTRY_MAX = 300;
export const TASK_OUTPUT_LINES = 40;
export const TASK_OUTPUT_MAX = 1500;
export const TITLE_MAX = 30;
export const ECHO_MAX = 40;
export const QUOTE_MAX = 2000;

// Sessions

/** A progress push is sent when a run lasts longer than this. */
export const PROGRESS_AFTER_MS = 10 * MINUTE;
/** The routing acknowledgement is sent when the current session was idle this long. */
export const CURRENT_IDLE_ACK_MS = 2 * HOUR;
export const TRACKED_MAX = 20;
/** An adopted session is untracked after this long idle. */
export const TRACK_IDLE_MS = 24 * HOUR;
export const OBSERVED_SESSIONS_MAX = 200;
/** The bridge stops holding a project unused for this long. */
export const HOLD_IDLE_MS = 10 * MINUTE;

// Files

/** Largest file received from or sent to WeChat. To be confirmed in phase 0. */
export const FILE_MAX_BYTES = 100 * 1024 * 1024;
export const PENDING_ATTACHMENTS_MAX = 10;
export const PENDING_ATTACHMENT_TTL_MS = 10 * MINUTE;
/** To be confirmed in phase 0. */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 60 * SECOND;

// State

export const OUT_QUEUE_MAX = 20;
export const SEEN_MAX = 500;
export const ORIGINS_MAX = 500;
export const INBOX_MAX = 50;
export const STATE_WRITE_DEBOUNCE_MS = 500;
export const TOKEN_MAX_LENGTH = 4096;

// Pairing

export const PAIR_CODE_TTL_MS = 5 * MINUTE;
export const PAIR_ATTEMPTS_MAX = 3;
/** Times the pairing code is sent to WeChat. */
export const PAIR_SENDS_MAX = 2;
