import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  isUserAvatar,
  isUserColor,
  MAX_USER_NAME_LENGTH,
  PRIMARY_USER_ID,
  USER_ARGUMENT_PREFIX,
  type PineUser,
  type PineUserInput,
} from "../shared/users";

/** The registry; only written once a second user is added. */
export const USERS_FILE = "users.json";
/** Where users other than the primary keep their data. */
export const USERS_DIRECTORY = "users";

const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Model connections: whole files copied from the agent folder. */
const CONNECTION_FILES = [
  "auth.json",
  "models.json",
  "models-store.json",
  "decisions-models.json",
  "video-models.json",
] as const;
/** Pi's model choice, without its other settings. */
const PI_MODEL_SETTINGS = [
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "enabledModels",
] as const;
/** Pine's model choices, without the profile, approvals or remote settings. */
const PINE_MODEL_SETTINGS = [
  "imageModel",
  "videoModel",
  "utilityModel",
  "approvalModel",
  "promptRewriteModel",
  "liveTranslationModel",
  "contextCompactionRoute",
  "piProviders",
] as const;
/** Pine's own key, encrypted with the account's key, so it copies as is. */
const TINYFISH_KEY_FILE = "tinyfish-api-key";

export interface UsersFile {
  users: PineUser[];
  lastUserId: string;
  askAtLaunch: boolean;
}

export interface LoadedUsers extends UsersFile {
  /** users.json exists but could not be read. */
  damaged: boolean;
}

export interface UserRegistryOptions {
  /** `app.getPath("userData")`. */
  userData: string;
  /** Moves a folder to the Trash; rejects when it cannot. */
  trash(folder: string): Promise<void>;
  /** The primary user's nickname, used as their name until one is chosen. */
  primaryName?(): Promise<string>;
  now?: () => Date;
  createId?: () => string;
}

export class UserRegistryError extends Error {
  constructor(
    readonly code:
      | "damaged"
      | "invalid"
      | "duplicate-name"
      | "not-found"
      | "protected"
      | "trash-failed",
    message: string,
  ) {
    super(message);
    this.name = "UserRegistryError";
  }
}

function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length <= MAX_USER_NAME_LENGTH &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function parseUser(value: unknown): PineUser | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const user = value as Record<string, unknown>;
  const id = user.id;
  if (typeof id !== "string" || (id !== PRIMARY_USER_ID && !USER_ID.test(id)))
    return undefined;
  if (!validName(user.name)) return undefined;
  if (id !== PRIMARY_USER_ID && user.name.trim() === "") return undefined;
  return {
    id,
    name: user.name.trim(),
    avatar: isUserAvatar(user.avatar) ? user.avatar : null,
    color: isUserColor(user.color) ? user.color : "green",
    createdAt: typeof user.createdAt === "string" ? user.createdAt : "",
    ...(typeof user.lastUsedAt === "string"
      ? { lastUsedAt: user.lastUsedAt }
      : {}),
  };
}

/** Throws when the file's contents are not a registry Pine can trust. */
export function parseUsersFile(text: string): UsersFile {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("users.json is not an object.");
  const file = parsed as Record<string, unknown>;
  if (file.version !== 1 || !Array.isArray(file.users))
    throw new Error("users.json has an unknown version.");
  const users = file.users.map(parseUser);
  if (users.some((user) => user === undefined))
    throw new Error("users.json has an invalid user.");
  const valid = users as PineUser[];
  const ids = new Set(valid.map(({ id }) => id));
  if (ids.size !== valid.length || !ids.has(PRIMARY_USER_ID))
    throw new Error("users.json has duplicate or missing users.");
  const lastUserId =
    typeof file.lastUserId === "string" && ids.has(file.lastUserId)
      ? file.lastUserId
      : PRIMARY_USER_ID;
  return {
    users: valid,
    lastUserId,
    askAtLaunch: file.askAtLaunch !== false,
  };
}

/** Who Pine starts as, or `undefined` to ask. */
export function launchUser(
  users: LoadedUsers,
  argv: readonly string[],
): string | undefined {
  if (users.users.length <= 1) return PRIMARY_USER_ID;
  const requested = argv
    .find((argument) => argument.startsWith(USER_ARGUMENT_PREFIX))
    ?.slice(USER_ARGUMENT_PREFIX.length);
  if (requested && users.users.some(({ id }) => id === requested))
    return requested;
  if (!users.askAtLaunch) return users.lastUserId;
  return undefined;
}

/** The arguments a switch relaunches with: the same, naming the new user. */
export function relaunchArguments(
  argv: readonly string[],
  userId: string,
): string[] {
  return [
    ...argv.filter((argument) => !argument.startsWith(USER_ARGUMENT_PREFIX)),
    `${USER_ARGUMENT_PREFIX}${userId}`,
  ];
}

async function readJsonObject(
  file: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function writePrivateFile(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, file);
}

function pickKeys(
  source: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys)
    if (source && Object.hasOwn(source, key)) picked[key] = source[key];
  return picked;
}

/**
 * Copies model connections and model choices from one user's data folder to
 * a new user's. Nothing about the person (memory, sessions, projects,
 * profile, remote bindings) is copied.
 */
export async function copyModelConnections(
  fromRoot: string,
  toRoot: string,
): Promise<void> {
  const fromAgent = path.join(fromRoot, "agent");
  const toAgent = path.join(toRoot, "agent");
  await mkdir(toAgent, { recursive: true, mode: 0o700 });
  for (const name of CONNECTION_FILES) {
    const destination = path.join(toAgent, name);
    try {
      await copyFile(path.join(fromAgent, name), destination);
      await chmod(destination, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const piSettings = pickKeys(
    await readJsonObject(path.join(fromAgent, "settings.json")),
    PI_MODEL_SETTINGS,
  );
  if (Object.keys(piSettings).length > 0)
    await writePrivateFile(
      path.join(toAgent, "settings.json"),
      `${JSON.stringify(piSettings, null, 2)}\n`,
    );
  const pineSettings = pickKeys(
    await readJsonObject(path.join(fromAgent, "pine-settings.json")),
    PINE_MODEL_SETTINGS,
  );
  if (Object.keys(pineSettings).length > 0)
    await writePrivateFile(
      path.join(toAgent, "pine-settings.json"),
      `${JSON.stringify(pineSettings, null, 2)}\n`,
    );
  try {
    const destination = path.join(toRoot, TINYFISH_KEY_FILE);
    await copyFile(path.join(fromRoot, TINYFISH_KEY_FILE), destination);
    await chmod(destination, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * The list of Pine users. The primary user's data stays at the root of
 * userData, exactly where Pine has always kept it; other users live in
 * `users/<id>/`. Without users.json there is only the primary user, so
 * deleting it returns Pine to a single user with nothing moved.
 */
export class UserRegistry {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: UserRegistryOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  get filePath(): string {
    return path.join(this.options.userData, USERS_FILE);
  }

  /** Where a user's data lives. */
  dataRoot(userId: string): string {
    if (userId === PRIMARY_USER_ID) return this.options.userData;
    if (!USER_ID.test(userId))
      throw new UserRegistryError("invalid", "Unknown user.");
    return path.join(this.options.userData, USERS_DIRECTORY, userId);
  }

  async load(): Promise<LoadedUsers> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("Could not read users.json.", error);
      return {
        ...(await this.singleUser()),
        damaged: (error as NodeJS.ErrnoException).code !== "ENOENT",
      };
    }
    try {
      return { ...parseUsersFile(text), damaged: false };
    } catch (error) {
      // Never overwritten: Pine runs as the primary user and refuses changes.
      console.error("users.json is damaged; Pine runs as one user.", error);
      return { ...(await this.singleUser()), damaged: true };
    }
  }

  private async singleUser(): Promise<UsersFile> {
    let name = "";
    try {
      name = (await this.options.primaryName?.())?.trim() ?? "";
    } catch {
      // A missing profile leaves the name for the user to choose.
    }
    return {
      users: [
        {
          id: PRIMARY_USER_ID,
          name: validName(name) ? name : "",
          avatar: null,
          color: "green",
          createdAt: "",
        },
      ],
      lastUserId: PRIMARY_USER_ID,
      askAtLaunch: true,
    };
  }

  /** Runs changes one at a time against the latest file. */
  private change<T>(
    apply: (users: UsersFile) => Promise<{ next: UsersFile; result: T }>,
  ): Promise<T> {
    const run = this.writes.then(async () => {
      const current = await this.load();
      if (current.damaged)
        throw new UserRegistryError(
          "damaged",
          "Pine cannot read its list of users, so it will not change it.",
        );
      const { next, result } = await apply(current);
      await this.save(next);
      return result;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async save(users: UsersFile): Promise<void> {
    await mkdir(this.options.userData, { recursive: true });
    await writePrivateFile(
      this.filePath,
      // Only the file's own fields: callers pass what they loaded, which
      // also carries runtime state such as `damaged`.
      `${JSON.stringify(
        {
          version: 1,
          users: users.users,
          lastUserId: users.lastUserId,
          askAtLaunch: users.askAtLaunch,
        },
        null,
        2,
      )}\n`,
    );
  }

  private static normalizeInput(
    input: PineUserInput,
    users: readonly PineUser[],
    exceptId?: string,
  ): PineUserInput {
    if (!validName(input.name) || input.name.trim() === "")
      throw new UserRegistryError("invalid", "A name is required.");
    if (input.avatar !== null && !isUserAvatar(input.avatar))
      throw new UserRegistryError("invalid", "Unknown avatar.");
    if (!isUserColor(input.color))
      throw new UserRegistryError("invalid", "Unknown colour.");
    const name = input.name.trim();
    const folded = name.toLocaleLowerCase();
    if (
      users.some(
        (user) =>
          user.id !== exceptId && user.name.toLocaleLowerCase() === folded,
      )
    )
      throw new UserRegistryError(
        "duplicate-name",
        "Another user already has this name.",
      );
    return { name, avatar: input.avatar, color: input.color };
  }

  async create(
    input: PineUserInput,
    copyConnectionsFrom?: string,
  ): Promise<PineUser> {
    return this.change(async (current) => {
      const fields = UserRegistry.normalizeInput(input, current.users);
      const id = this.createId();
      const root = this.dataRoot(id);
      await mkdir(root, { recursive: true, mode: 0o700 });
      try {
        if (copyConnectionsFrom)
          await copyModelConnections(this.dataRoot(copyConnectionsFrom), root);
      } catch (error) {
        // Only this new, unregistered folder is removed.
        await rm(root, { recursive: true, force: true });
        throw error;
      }
      const user: PineUser = {
        id,
        ...fields,
        createdAt: this.now().toISOString(),
      };
      return {
        next: { ...current, users: [...current.users, user] },
        result: user,
      };
    });
  }

  async update(id: string, input: PineUserInput): Promise<PineUser> {
    return this.change((current) => {
      const index = current.users.findIndex((user) => user.id === id);
      if (index < 0) throw new UserRegistryError("not-found", "Unknown user.");
      const updated = {
        ...current.users[index],
        ...UserRegistry.normalizeInput(input, current.users, id),
      };
      const users = current.users.map((user, at) =>
        at === index ? updated : user,
      );
      return Promise.resolve({ next: { ...current, users }, result: updated });
    });
  }

  /**
   * Moves the user's folder to the Trash, then forgets them. The primary
   * user and the user Pine runs as cannot be deleted; nothing is ever
   * deleted outright.
   */
  async remove(id: string, currentUserId: string | null): Promise<void> {
    return this.change(async (current) => {
      if (id === PRIMARY_USER_ID || id === currentUserId)
        throw new UserRegistryError(
          "protected",
          "This user cannot be deleted.",
        );
      if (!current.users.some((user) => user.id === id))
        throw new UserRegistryError("not-found", "Unknown user.");
      const root = this.dataRoot(id);
      try {
        await this.options.trash(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new UserRegistryError(
            "trash-failed",
            `The user's folder could not be moved to the Trash: ${String(
              error instanceof Error ? error.message : error,
            )}`,
          );
      }
      const users = current.users.filter((user) => user.id !== id);
      return {
        next: {
          ...current,
          users,
          lastUserId:
            current.lastUserId === id ? PRIMARY_USER_ID : current.lastUserId,
        },
        result: undefined,
      };
    });
  }

  /** Remembers who used Pine last; written only when there is a registry. */
  async markUsed(id: string): Promise<void> {
    const loaded = await this.load();
    if (loaded.users.length <= 1 || loaded.damaged) return;
    await this.change((current) => {
      const at = this.now().toISOString();
      return Promise.resolve({
        next: {
          ...current,
          lastUserId: id,
          users: current.users.map((user) =>
            user.id === id ? { ...user, lastUsedAt: at } : user,
          ),
        },
        result: undefined,
      });
    });
  }

  async setAskAtLaunch(askAtLaunch: boolean): Promise<void> {
    await this.change((current) =>
      Promise.resolve({ next: { ...current, askAtLaunch }, result: undefined }),
    );
  }
}
