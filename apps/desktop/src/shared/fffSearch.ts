/** Names of the file search tools backed by fff. */
export const FFF_FIND_TOOL_NAME = "find" as const;
export const FFF_GREP_TOOL_NAME = "grep" as const;

/** What `find` reports beside its text, for the transcript marker. */
export interface FffFindDetails {
  mode: "fuzzy" | "glob";
  query: string;
  /** Every file that matched, of which `files` holds the first page. */
  total: number;
  files: string[];
  /** The folder was still being indexed, so the list may be incomplete. */
  indexing: boolean;
}

export interface FffGrepMatchDetail {
  path: string;
  line: number;
  text: string;
}

/** What `grep` reports beside its text, for the transcript marker. */
export interface FffGrepDetails {
  mode: "plain" | "regex" | "fuzzy" | "multi";
  pattern: string;
  scope?: string;
  /** Matching lines in this page. */
  total: number;
  files: number;
  matches: FffGrepMatchDetail[];
  hasMore: boolean;
  indexing: boolean;
}
