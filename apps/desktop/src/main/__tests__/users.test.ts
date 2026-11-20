import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRIMARY_USER_ID } from "../../shared/users";
import {
  copyModelConnections,
  launchUser,
  parseUsersFile,
  relaunchArguments,
  UserRegistry,
  USERS_FILE,
  type LoadedUsers,
} from "../users";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "pine-users-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** A data folder laid out the way Pine 0.22.0 leaves it. */
function legacyUserData(): string {
  const root = temporaryDirectory();
  const files: Record<string, string> = {
    "agent/auth.json": '{"openai":{"type":"api_key","key":"sk-test"}}',
    "agent/models.json": '{"providers":{}}',
    "agent/models-store.json": "{}",
    "agent/settings.json":
      '{"defaultProvider":"openai","defaultModel":"gpt-test","theme":"dark","packages":["x"]}',
    "agent/pine-settings.json": JSON.stringify({
      utilityModel: { providerId: "openai", modelId: "gpt-mini" },
      userProfile: { nickname: "Kai" },
      webServer: { enabled: true },
      autoApproval: { enabled: true },
    }),
    "agent/memory/identity.md": "Kai likes pine trees.",
    "agent/wechat-remote.json": "{}",
    "agent/skills/humanizer/SKILL.md": "skill",
    "projects/p1/project.json": "{}",
    "projects/p1/sessions/s.jsonl": "{}",
    "tinyfish-api-key": "encrypted",
    "wechat-remote-secure": "secret",
    "ui-preferences.json": '{"pine.locale":"en-US"}',
  };
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return root;
}

function snapshot(root: string, skip: string[] = []): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full);
      if (skip.some((prefix) => relative.startsWith(prefix))) continue;
      if (entry.isDirectory()) walk(full);
      else result[relative] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return result;
}

let ids = 0;
function registry(userData: string, trashed: string[] = []): UserRegistry {
  return new UserRegistry({
    userData,
    trash: (folder) => {
      // Stands in for the system Trash: moved out of userData, not deleted.
      const bin = temporaryDirectory();
      renameSync(folder, path.join(bin, path.basename(folder)));
      trashed.push(folder);
      return Promise.resolve();
    },
    primaryName: () => Promise.resolve("Kai"),
    now: () => new Date("2026-11-20T10:00:00.000Z"),
    createId: () =>
      `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
}

const input = { name: "Mom", avatar: "🦊" as const, color: "amber" as const };

describe("UserRegistry", () => {
  it("is a single primary user without users.json", async () => {
    const root = legacyUserData();
    const loaded = await registry(root).load();
    expect(loaded.damaged).toBe(false);
    expect(loaded.users).toEqual([
      expect.objectContaining({ id: PRIMARY_USER_ID, name: "Kai" }),
    ]);
    expect(registry(root).dataRoot(PRIMARY_USER_ID)).toBe(root);
    expect(existsSync(path.join(root, USERS_FILE))).toBe(false);
  });

  it("adds a user without touching the primary user's data", async () => {
    const root = legacyUserData();
    const before = snapshot(root);
    const users = registry(root);
    const mom = await users.create(input);

    expect(snapshot(root, [USERS_FILE, "users"])).toEqual(before);
    expect(readdirSync(users.dataRoot(mom.id))).toEqual([]);
    const loaded = await users.load();
    expect(loaded.users.map(({ name }) => name)).toEqual(["Kai", "Mom"]);
    expect(statSync(path.join(root, USERS_FILE)).mode & 0o777).toBe(0o600);
    expect(
      Object.keys(
        JSON.parse(readFileSync(path.join(root, USERS_FILE), "utf8")) as object,
      ),
    ).toEqual(["version", "users", "lastUserId", "askAtLaunch"]);
  });

  it("returns to the original state when users.json is removed", async () => {
    const root = legacyUserData();
    const before = snapshot(root);
    await registry(root).create(input);
    rmSync(path.join(root, USERS_FILE));
    const loaded = await registry(root).load();
    expect(loaded.users).toHaveLength(1);
    expect(snapshot(root, ["users"])).toEqual(before);
  });

  it("copies only model connections and model choices", async () => {
    const root = legacyUserData();
    const users = registry(root);
    const mom = await users.create(input, PRIMARY_USER_ID);
    const copied = snapshot(users.dataRoot(mom.id));
    expect(Object.keys(copied).sort()).toEqual([
      "agent/auth.json",
      "agent/models-store.json",
      "agent/models.json",
      "agent/pine-settings.json",
      "agent/settings.json",
      "tinyfish-api-key",
    ]);
    expect(JSON.parse(copied["agent/settings.json"])).toEqual({
      defaultProvider: "openai",
      defaultModel: "gpt-test",
    });
    expect(JSON.parse(copied["agent/pine-settings.json"])).toEqual({
      utilityModel: { providerId: "openai", modelId: "gpt-mini" },
    });
    expect(
      statSync(path.join(users.dataRoot(mom.id), "agent/auth.json")).mode &
        0o777,
    ).toBe(0o600);
  });

  it("copies nothing when the source has no connections", async () => {
    const from = temporaryDirectory();
    const to = temporaryDirectory();
    await copyModelConnections(from, to);
    expect(snapshot(to)).toEqual({});
  });

  it("rejects empty and duplicate names", async () => {
    const users = registry(legacyUserData());
    await expect(users.create({ ...input, name: "  " })).rejects.toThrow();
    await users.create(input);
    await expect(users.create({ ...input, name: "mom" })).rejects.toThrow(
      /already/,
    );
  });

  it("renames without moving the folder", async () => {
    const users = registry(legacyUserData());
    const mom = await users.create(input);
    writeFileSync(path.join(users.dataRoot(mom.id), "marker"), "x");
    await users.update(mom.id, { name: "Mum", avatar: null, color: "rose" });
    const loaded = await users.load();
    expect(loaded.users[1]).toMatchObject({
      id: mom.id,
      name: "Mum",
      avatar: null,
      color: "rose",
    });
    expect(existsSync(path.join(users.dataRoot(mom.id), "marker"))).toBe(true);
  });

  it("moves a deleted user's folder to the Trash", async () => {
    const root = legacyUserData();
    const trashed: string[] = [];
    const users = registry(root, trashed);
    const mom = await users.create(input);
    await users.markUsed(mom.id);
    await users.remove(mom.id, PRIMARY_USER_ID);
    expect(trashed).toEqual([users.dataRoot(mom.id)]);
    const loaded = await users.load();
    expect(loaded.users).toHaveLength(1);
    expect(loaded.lastUserId).toBe(PRIMARY_USER_ID);
  });

  it("never deletes the primary or the current user", async () => {
    const users = registry(legacyUserData());
    const mom = await users.create(input);
    await expect(users.remove(PRIMARY_USER_ID, mom.id)).rejects.toThrow();
    await expect(users.remove(mom.id, mom.id)).rejects.toThrow();
  });

  it("keeps the user when the Trash refuses", async () => {
    const root = legacyUserData();
    const users = new UserRegistry({
      userData: root,
      trash: () => Promise.reject(new Error("no trash here")),
    });
    const mom = await users.create(input);
    await expect(users.remove(mom.id, PRIMARY_USER_ID)).rejects.toThrow(
      /Trash/,
    );
    expect((await users.load()).users).toHaveLength(2);
    expect(existsSync(users.dataRoot(mom.id))).toBe(true);
  });

  it("refuses changes and never overwrites a damaged users.json", async () => {
    const root = legacyUserData();
    writeFileSync(path.join(root, USERS_FILE), "{not json");
    const users = registry(root);
    const loaded = await users.load();
    expect(loaded.damaged).toBe(true);
    expect(loaded.users).toHaveLength(1);
    await expect(users.create(input)).rejects.toThrow(/cannot read/);
    expect(readFileSync(path.join(root, USERS_FILE), "utf8")).toBe("{not json");
  });

  it("does not write users.json for a single user", async () => {
    const root = legacyUserData();
    await registry(root).markUsed(PRIMARY_USER_ID);
    expect(existsSync(path.join(root, USERS_FILE))).toBe(false);
  });

  it("rejects ids that could leave the users folder", () => {
    expect(() => registry(legacyUserData()).dataRoot("../agent")).toThrow();
  });
});

describe("parseUsersFile", () => {
  it("requires the primary user", () => {
    expect(() =>
      parseUsersFile(JSON.stringify({ version: 1, users: [] })),
    ).toThrow();
  });
});

describe("launchUser", () => {
  const two: LoadedUsers = {
    users: [
      {
        id: PRIMARY_USER_ID,
        name: "Kai",
        avatar: null,
        color: "green",
        createdAt: "",
      },
      {
        id: "00000000-0000-4000-8000-000000000009",
        name: "Mom",
        avatar: null,
        color: "amber",
        createdAt: "",
      },
    ],
    lastUserId: "00000000-0000-4000-8000-000000000009",
    askAtLaunch: true,
    damaged: false,
  };

  it("starts a single user straight away", () => {
    expect(launchUser({ ...two, users: two.users.slice(0, 1) }, [])).toBe(
      PRIMARY_USER_ID,
    );
  });

  it("asks when there are several users", () => {
    expect(launchUser(two, [])).toBeUndefined();
  });

  it("follows a switch's argument", () => {
    expect(
      launchUser(two, ["--pine-user=00000000-0000-4000-8000-000000000009"]),
    ).toBe("00000000-0000-4000-8000-000000000009");
    expect(launchUser(two, ["--pine-user=unknown"])).toBeUndefined();
  });

  it("continues as the last user when asked not to ask", () => {
    expect(launchUser({ ...two, askAtLaunch: false }, [])).toBe(two.lastUserId);
  });

  it("replaces an earlier user argument on relaunch", () => {
    expect(
      relaunchArguments(["main.js", "--pine-user=a", "--flag"], "b"),
    ).toEqual(["main.js", "--flag", "--pine-user=b"]);
  });
});
