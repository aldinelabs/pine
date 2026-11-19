import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: JsonRpcError;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
}

export class ComputerUseMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<number, PendingRequest>();
  private startPromise: Promise<void> | null = null;

  constructor(
    private readonly executablePath: string,
    private readonly args: readonly string[] = [],
  ) {}

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.child) return;
    this.startPromise = this.startChild();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.start();
    return this.request("tools/call", { name, arguments: args }, signal);
  }

  async dispose(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.rejectPending(new Error("Pine Computer Use stopped."));
  }

  private async startChild(): Promise<void> {
    await access(this.executablePath, constants.X_OK).catch(() => {
      throw new Error(
        `Pine Computer Use is not built for this platform. Expected executable: ${this.executablePath}`,
      );
    });
    const child = spawn(this.executablePath, [...this.args], {
      env: {
        ...process.env,
        COMPUTER_USE_ALLOW_SECURE_FIELD_INPUT: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) console.warn(`[Pine Computer Use] ${message}`);
    });
    child.once("error", (error) => {
      if (this.child === child) this.child = null;
      this.rejectPending(error);
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      this.rejectPending(
        new Error(
          `Pine Computer Use exited (${signal ?? `code ${code ?? "unknown"}`}).`,
        ),
      );
    });
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pine", version: "0.2.2" },
    });
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const child = this.child;
    if (!child)
      return Promise.reject(new Error("Pine Computer Use is not running."));
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (this.pending.get(id) !== pending) return;
        this.pending.delete(id);
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: id, reason: "Pine agent run was aborted" },
          })}\n`,
        );
        reject(new Error("aborted"));
      };
      const pending: PendingRequest = {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      this.pending.set(id, pending);
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (typeof response.id !== "number") continue;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      if (response.error) {
        pending.reject(
          new Error(
            `Pine Computer Use RPC ${response.error.code}: ${response.error.message}`,
          ),
        );
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
