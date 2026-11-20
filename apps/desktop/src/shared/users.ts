/**
 * Pine users: several people sharing one computer account and one Pine
 * install, each with their own conversations, projects, memory and model
 * connections. Not a security boundary; see docs/multi-profile.md.
 *
 * Called "users" rather than "profiles" because `userProfile` already names
 * the personalization settings (nickname, tone, work style).
 */

/** The user whose data has always lived at the root of Pine's data folder. */
export const PRIMARY_USER_ID = "primary";

export const MAX_USER_NAME_LENGTH = 40;

export const USER_COLORS = [
  "green",
  "blue",
  "violet",
  "rose",
  "amber",
  "teal",
  "orange",
  "slate",
] as const;
export type PineUserColor = (typeof USER_COLORS)[number];

export const USER_AVATARS = [
  "🌲",
  "🦊",
  "🐼",
  "🐱",
  "🐶",
  "🐰",
  "🐻",
  "🦉",
  "🐢",
  "🐳",
  "🌻",
  "🌙",
  "⭐",
  "🍀",
  "🎨",
  "🚀",
] as const;
export type PineUserAvatar = (typeof USER_AVATARS)[number];

export interface PineUser {
  id: string;
  /** Empty only for the primary user before anyone named it. */
  name: string;
  /** Null shows the name's first letter on the colour. */
  avatar: PineUserAvatar | null;
  color: PineUserColor;
  createdAt: string;
  lastUsedAt?: string;
}

export interface PineUserInput {
  name: string;
  avatar: PineUserAvatar | null;
  color: PineUserColor;
}

export interface PineUsersState {
  users: PineUser[];
  /** The user Pine runs as; null while "Who's using Pine?" is showing. */
  currentUserId: string | null;
  lastUserId: string;
  /** Show "Who's using Pine?" at launch when there is more than one user. */
  askAtLaunch: boolean;
  /** users.json exists but cannot be read; changes are refused. */
  damaged: boolean;
}

export interface CreatePineUserRequest extends PineUserInput {
  /** Copy the current user's model connections and model choices. */
  copyModelConnections: boolean;
}

export interface UpdatePineUserRequest extends PineUserInput {
  id: string;
}

/** What `switchTo` did: Pine restarts as that user, or the user said no. */
export type SwitchPineUserResult = "restarting" | "cancelled";

export const GET_USERS_CHANNEL = "users:get";
export const CREATE_USER_CHANNEL = "users:create";
export const UPDATE_USER_CHANNEL = "users:update";
export const DELETE_USER_CHANNEL = "users:delete";
export const SET_ASK_AT_LAUNCH_CHANNEL = "users:set-ask-at-launch";
/** From "Who's using Pine?": start as this user. */
export const CHOOSE_USER_CHANNEL = "users:choose";
/** From a running Pine: restart as this user. */
export const SWITCH_USER_CHANNEL = "users:switch";
export const USERS_CHANGED_CHANNEL = "users:changed";

/** The route that shows "Who's using Pine?". */
export const USER_PICKER_ROUTE_HASH = "who";

/** Command-line argument a switch relaunches with. */
export const USER_ARGUMENT_PREFIX = "--pine-user=";

export interface PineUsersApi {
  get(): Promise<PineUsersState>;
  create(request: CreatePineUserRequest): Promise<PineUsersState>;
  update(request: UpdatePineUserRequest): Promise<PineUsersState>;
  remove(id: string): Promise<PineUsersState>;
  setAskAtLaunch(ask: boolean): Promise<PineUsersState>;
  choose(request: { id: string; remember: boolean }): Promise<void>;
  switchTo(id: string): Promise<SwitchPineUserResult>;
  onChanged(listener: (state: PineUsersState) => void): () => void;
}

export function isUserColor(value: unknown): value is PineUserColor {
  return (USER_COLORS as readonly unknown[]).includes(value);
}

export function isUserAvatar(value: unknown): value is PineUserAvatar {
  return (USER_AVATARS as readonly unknown[]).includes(value);
}

/** The letter shown on a user's colour when they picked no emoji. */
export function userInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "";
}
