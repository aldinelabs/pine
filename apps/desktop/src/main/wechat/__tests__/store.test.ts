// @vitest-environment node
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WECHAT_SETTINGS } from "../../../shared/wechatRemote";
import type { TinyFishSafeStorage } from "../../tinyfishCredentials";
import { ASK_MIN, SEEN_MAX } from "../constants";
import { WeChatStore } from "../store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function fakeStorage(available = true): TinyFishSafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) =>
      Buffer.from(`sealed:${Buffer.from(text).toString("hex")}`),
    decryptString: (data) => {
      const text = data.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("cannot decrypt");
      return Buffer.from(text.slice("sealed:".length), "hex").toString("utf8");
    },
  };
}

async function setup(storage = fakeStorage()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pine-wechat-store-"));
  directories.push(directory);
  const statePath = path.join(directory, "agent", "wechat-remote.json");
  const securePath = path.join(directory, "data", "wechat-remote-secure");
  await mkdir(path.dirname(statePath), { recursive: true });
  await mkdir(path.dirname(securePath), { recursive: true });
  const open = (override = storage, debounceMs = 5) =>
    new WeChatStore({
      statePath,
      securePath,
      storage: override,
      debounceMs,
    });
  return { directory, statePath, securePath, open };
}

const OWNER = {
  userId: "user@im.wechat",
  botId: "bot@im.bot",
  baseUrl: "https://ilinkai.weixin.qq.com",
  boundAt: 1,
};

describe("WeChatStore plain state", () => {
  it("starts with defaults and writes 0600 files", async () => {
    const { open, statePath, securePath } = await setup();
    const store = open();
    expect(await store.load()).toBe("ok");
    expect(store.get()).toMatchObject({
      version: 1,
      language: "auto",
      cursor: "",
      nextAsk: ASK_MIN,
      inbox: [],
    });
    expect(store.secure()).toEqual({
      version: 1,
      settings: DEFAULT_WECHAT_SETTINGS,
      paused: false,
    });
    await store.update((draft) => {
      draft.cursor = "cursor-1";
    });
    await store.updateSecure((draft) => {
      draft.paused = true;
    });
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    expect((await stat(securePath)).mode & 0o777).toBe(0o600);
  });

  it("reloads what it wrote", async () => {
    const { open } = await setup();
    const first = open();
    await first.load();
    await first.update((draft) => {
      draft.language = "zh";
      draft.tracked.push({
        sessionId: "s1",
        projectId: "p1",
        origin: "wechat",
        trackedAtMs: 1,
        lastUsedAtMs: 2,
      });
      draft.current = { projectId: "p1", sessionId: "s1", usedAtMs: 2 };
    });
    const second = open();
    await second.load();
    expect(second.get().language).toBe("zh");
    expect(second.get().tracked).toHaveLength(1);
    expect(second.get().current).toEqual({
      projectId: "p1",
      sessionId: "s1",
      usedAtMs: 2,
    });
  });

  it("falls back to defaults for a corrupt file, and per field for a bad field", async () => {
    const { open, statePath } = await setup();
    const store = open();
    await store.load();
    await store.update((draft) => {
      draft.cursor = "keep";
    });
    await writeFile(statePath, "{not json");
    const corrupt = open();
    await corrupt.load();
    expect(corrupt.get().cursor).toBe("");

    await writeFile(
      statePath,
      JSON.stringify({ cursor: "kept", inbox: "nope", nextAsk: "x" }),
    );
    const partial = open();
    await partial.load();
    expect(partial.get().cursor).toBe("kept");
    expect(partial.get().inbox).toEqual([]);
    expect(partial.get().nextAsk).toBe(ASK_MIN);
  });

  it("keeps lists within their bounds, newest last", async () => {
    const { open } = await setup();
    const store = open();
    await store.load();
    await store.update((draft) => {
      for (let index = 0; index < SEEN_MAX + 5; index += 1) {
        draft.seenMessageIds.push(`m${index}`);
      }
    });
    expect(store.get().seenMessageIds).toHaveLength(SEEN_MAX);
    expect(store.get().seenMessageIds.at(-1)).toBe(`m${SEEN_MAX + 4}`);
    expect(store.get().seenMessageIds[0]).toBe("m5");
  });

  it("applies updateSoon at once and writes it after the debounce or on flush", async () => {
    const { open, statePath } = await setup();
    const store = open();
    await store.load();
    store.updateSoon((draft) => {
      draft.cursor = "soon";
    });
    expect(store.get().cursor).toBe("soon");
    await store.flush();
    expect(JSON.parse(await readFile(statePath, "utf8"))).toMatchObject({
      cursor: "soon",
    });
    store.updateSoon((draft) => {
      draft.cursor = "later";
    });
    await expect
      .poll(async () => JSON.parse(await readFile(statePath, "utf8")).cursor)
      .toBe("later");
  });
});

describe("WeChatStore sealed blob", () => {
  it("round-trips the token without writing it in plain text", async () => {
    const { open, securePath } = await setup();
    const store = open();
    await store.load();
    await store.updateSecure((draft) => {
      draft.token = "secret-token";
      draft.owner = OWNER;
    });
    expect(await readFile(securePath, "utf8")).not.toContain("secret-token");
    const again = open();
    expect(await again.load()).toBe("ok");
    expect(again.secure().token).toBe("secret-token");
    expect(again.secure().owner).toEqual(OWNER);
  });

  it("starts paused with default settings when the blob is tampered with", async () => {
    const { open, securePath } = await setup();
    const store = open();
    await store.load();
    await store.updateSecure((draft) => {
      draft.token = "secret-token";
      draft.owner = OWNER;
      draft.settings = { ...draft.settings, ceilingMode: "YOLO" };
    });
    await writeFile(securePath, Buffer.from("garbage").toString("base64"));
    const tampered = open();
    expect(await tampered.load()).toBe("reset");
    expect(tampered.secure()).toEqual({
      version: 1,
      settings: DEFAULT_WECHAT_SETTINGS,
      paused: true,
    });
  });

  it("resets a blob that decrypts but does not validate", async () => {
    const { open, securePath } = await setup();
    const storage = fakeStorage();
    await open().load();
    await writeFile(
      securePath,
      storage
        .encryptString(JSON.stringify({ version: 1, paused: "no" }))
        .toString("base64"),
    );
    const store = open();
    expect(await store.load()).toBe("reset");
    expect(store.secure().paused).toBe(true);
  });

  it("cannot read or write the blob without encryption", async () => {
    const { open } = await setup();
    const writer = open();
    await writer.load();
    await writer.updateSecure((draft) => {
      draft.paused = false;
    });
    const store = open(fakeStorage(false));
    expect(store.canEncrypt()).toBe(false);
    expect(await store.load()).toBe("reset");
    await expect(
      store.updateSecure((draft) => {
        draft.paused = false;
      }),
    ).rejects.toThrow(/secure credential store/);
  });

  it("treats a missing blob as defaults, not paused", async () => {
    const { open } = await setup(fakeStorage(false));
    const store = open();
    expect(await store.load()).toBe("ok");
    expect(store.secure().paused).toBe(false);
  });

  it("clamps the settings it reads", async () => {
    const { open, securePath } = await setup();
    const storage = fakeStorage();
    await writeFile(
      securePath,
      storage
        .encryptString(
          JSON.stringify({
            version: 1,
            paused: false,
            settings: {
              ...DEFAULT_WECHAT_SETTINGS,
              ceilingMode: "let-me-review",
              defaultMode: "YOLO",
            },
          }),
        )
        .toString("base64"),
    );
    const store = open();
    expect(await store.load()).toBe("ok");
    expect(store.secure().settings.defaultMode).toBe("let-me-review");
  });

  it("keeps a change another store instance wrote to disk", async () => {
    const { open } = await setup();
    const running = open();
    await running.load();
    const offline = open();
    await offline.load();
    await offline.updateSecure((draft) => {
      draft.settings = { ...draft.settings, allowFileSending: true };
    });
    await running.updateSecure((draft) => {
      draft.paused = true;
    });
    expect(running.secure().settings.allowFileSending).toBe(true);
    expect(running.secure().paused).toBe(true);
    const reread = open();
    await reread.load();
    expect(reread.secure().settings.allowFileSending).toBe(true);
  });

  it("re-reads the blob on reloadSecure", async () => {
    const { open } = await setup();
    const running = open();
    await running.load();
    const offline = open();
    await offline.load();
    await offline.updateSecure((draft) => {
      draft.paused = true;
    });
    expect(running.secure().paused).toBe(false);
    expect(await running.reloadSecure()).toBe("ok");
    expect(running.secure().paused).toBe(true);
  });

  it("re-reads only the language from the plain file on reloadLanguage", async () => {
    const { open } = await setup();
    // A long debounce keeps the pending write from racing the offline edit.
    const running = open(undefined, 60_000);
    await running.load();
    running.updateSoon((draft) => {
      draft.cursor = "kept";
    });
    const offline = open();
    await offline.load();
    await offline.update((draft) => {
      draft.language = "en";
    });
    await running.reloadLanguage();
    expect(running.get().language).toBe("en");
    expect(running.get().cursor).toBe("kept");
    await running.flush();
  });

  it("clearBinding removes the account, resets permissions and keeps language and default project", async () => {
    const { open } = await setup();
    const store = open();
    await store.load();
    await store.updateSecure((draft) => {
      draft.token = "secret-token";
      draft.owner = OWNER;
      draft.settings = {
        ceilingMode: "YOLO",
        defaultMode: "autonomous",
        defaultProjectId: "project-1",
        allowHighRiskApprovals: true,
        allowFileSending: true,
      };
    });
    await store.update((draft) => {
      draft.language = "en";
      draft.cursor = "cursor-9";
      draft.seenMessageIds.push("m1");
    });
    await store.clearBinding();
    expect(store.secure().token).toBeUndefined();
    expect(store.secure().owner).toBeUndefined();
    expect(store.secure().settings).toEqual({
      ...DEFAULT_WECHAT_SETTINGS,
      defaultProjectId: "project-1",
    });
    expect(store.get()).toMatchObject({
      language: "en",
      cursor: "",
      seenMessageIds: [],
    });
    const again = open();
    await again.load();
    expect(again.secure().token).toBeUndefined();
    expect(again.get().language).toBe("en");
  });

  it("reads the old keep-awake switch once for migration and drops it from settings", async () => {
    const { open, securePath } = await setup();
    const decode = async () => {
      const sealed = Buffer.from(
        (await readFile(securePath, "utf8")).trim(),
        "base64",
      ).toString("utf8");
      return Buffer.from(sealed.slice("sealed:".length), "hex").toString(
        "utf8",
      );
    };
    const seed = open();
    await seed.load();
    expect(seed.legacyKeepAwake()).toBe(false);
    await seed.updateSecure((draft) => {
      (draft.settings as unknown as Record<string, unknown>).keepAwake = true;
    });
    expect(await decode()).toContain("keepAwake");

    const store = open();
    await store.load();
    expect(store.legacyKeepAwake()).toBe(true);
    expect(store.secure().settings).not.toHaveProperty("keepAwake");
    await store.updateSecure((draft) => {
      draft.paused = true;
    });
    expect(store.legacyKeepAwake()).toBe(true);
    expect(await decode()).not.toContain("keepAwake");

    const fresh = open();
    await fresh.load();
    expect(fresh.legacyKeepAwake()).toBe(false);
  });
});
