import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readPineAgentSettings,
  writePiProvidersSetting,
} from "../../../../agent/pineSettings";
import type { PineCore } from "../../pineCore";
import { setPiProviders } from "../settings";

let agentDirectory: string;
let syncPiProviders: ReturnType<typeof vi.fn>;
let core: PineCore;

beforeEach(async () => {
  agentDirectory = await mkdtemp(path.join(os.tmpdir(), "pine-pi-setting-"));
  syncPiProviders = vi.fn().mockResolvedValue({ enabled: true, count: 0 });
  core = {
    agentDirectory,
    runtimes: { syncPiProviders },
  } as unknown as PineCore;
});

afterEach(async () => {
  await rm(agentDirectory, { recursive: true, force: true });
});

it("saves the switch, keeps a chosen folder and asks the agent to re-read", async () => {
  await writePiProvidersSetting(agentDirectory, {
    enabled: false,
    agentDir: "/opt/pi",
  });
  await setPiProviders(core, { enabled: true });
  expect((await readPineAgentSettings(agentDirectory)).piProviders).toEqual({
    enabled: true,
    agentDir: "/opt/pi",
  });
  expect(syncPiProviders).toHaveBeenCalledTimes(1);

  await setPiProviders(core, { enabled: true, agentDir: null });
  expect((await readPineAgentSettings(agentDirectory)).piProviders).toEqual({
    enabled: true,
  });
});

it("rejects relative folders", async () => {
  await expect(
    setPiProviders(core, { enabled: true, agentDir: "relative/pi" }),
  ).rejects.toThrow();
  expect(syncPiProviders).not.toHaveBeenCalled();
});
