/** The channel to the process that started the agent. */
export interface AgentParentPort {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
}

/**
 * The desktop starts the agent as an Electron utility process; the headless
 * server forks it with Node's IPC channel. Both carry structured clones.
 */
export function connectParentPort(
  host: NodeJS.Process = process,
): AgentParentPort {
  const { parentPort } = host;
  if (parentPort)
    return {
      postMessage: (message) => parentPort.postMessage(message),
      onMessage: (listener) =>
        parentPort.on("message", (event) => listener(event.data)),
    };
  const send = host.send?.bind(host);
  if (send) {
    // A forked agent outlives nothing: without its parent it has no one to
    // answer, and its tools must not keep running.
    host.once("disconnect", () => host.exit(0));
    return {
      postMessage: (message) => void send(message),
      onMessage: (listener) => host.on("message", listener),
    };
  }
  throw new Error("Pine agent must run as a child process of Pine.");
}
