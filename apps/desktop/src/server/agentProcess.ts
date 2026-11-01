import { fork } from "node:child_process";
import type { AgentProcess } from "../main/agentProcessHost";

/**
 * Starts the agent worker as a Node child process. Advanced serialization
 * carries the same structured clones as Electron's utility process.
 */
export function forkAgentProcess(
  modulePath: string,
  env: NodeJS.ProcessEnv,
): AgentProcess {
  const child = fork(modulePath, [], {
    env,
    serialization: "advanced",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  // The headless server has no console of its own to lose, so the agent's
  // output goes to the server's log.
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  const agent: AgentProcess = {
    stdout: child.stdout,
    stderr: child.stderr,
    kill: () => child.kill(),
    postMessage: (message) => {
      if (child.connected) child.send(message);
    },
    on(event: "exit" | "message", listener: (value: never) => void) {
      if (event === "exit")
        child.on("exit", (code, signal) =>
          (listener as (code: number | string) => void)(code ?? signal ?? -1),
        );
      else child.on("message", listener as (message: unknown) => void);
      return agent;
    },
  };
  return agent;
}
