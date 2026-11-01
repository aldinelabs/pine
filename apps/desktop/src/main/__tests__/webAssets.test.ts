// @vitest-environment node
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { serveWebAsset } from "../webAssets";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("browser renderer assets", () => {
  it("serves the built entry and refuses symlinks outside its asset root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-web-assets-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pine-web-outside-"));
    roots.push(root, outside);
    await writeFile(path.join(root, "index.html"), "<html>Pine</html>");
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(root, "secret.txt"),
    );
    const entry = await serveWebAsset(
      new Request("http://127.0.0.1:9415/"),
      root,
    );
    expect(entry.headers.get("Content-Type")).toContain("text/html");
    expect(await entry.text()).toBe("<html>Pine</html>");
    expect(
      (
        await serveWebAsset(
          new Request("http://127.0.0.1:9415/secret.txt"),
          root,
        )
      ).status,
    ).toBe(403);
  });
});
