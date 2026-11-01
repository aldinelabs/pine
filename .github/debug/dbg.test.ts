import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "vitest";
import { PineToolAccessPolicy } from "../tool-access-policy";
import { createBashEnvironment } from "../bash-env";
import { runSandbox } from "../sandbox/backend";
import { createSandboxConfig } from "../sandbox/policy";
it("dbg", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-isolation-"));
  const cwd = path.join(root, "proj"); const temp = path.join(cwd, "tmp");
  await mkdir(temp, { recursive: true });
  const policy = await PineToolAccessPolicy.create(cwd, [{ path: cwd, access: "read-write" }]);
  const env = createBashEnvironment({}, temp, "/usr/bin:/bin", cwd);
  const config = createSandboxConfig(policy, [process.execPath]);
  for (const command of ["printf ok", "printf ok; exit 7", "echo hi >&2; /bin/cat /etc/hostname"]) {
    let output = "";
    const r = await runSandbox({ command, cwd, env, config }, { timeout: 10, onData: (c) => { output += c.toString(); } });
    console.log("CMD", command, "=>", JSON.stringify(r), JSON.stringify(output));
  }
});
