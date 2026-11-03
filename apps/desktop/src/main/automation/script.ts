import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import type { PineJsonValue } from "../../shared/agent";
import type { AutomationFolderGrant } from "../../shared/automation";
import { parseCsv, parseXml } from "./parse";

export const SCRIPT_LIMITS = {
  timeoutMs: 30_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  requests: 10,
  responseBytes: 5 * 1024 * 1024,
  resultBytes: 256 * 1024,
  events: 100,
  logLines: 200,
  logLineChars: 2_000,
  readTextBytes: 1024 * 1024,
  redirects: 5,
} as const;

export interface ScriptFileEntry {
  path: string;
  name: string;
  size: number;
  mtime: string;
  kind: "file" | "directory";
}

/** Read-only file access confined to the script's granted folders. */
export interface ScriptFileSystem {
  list(
    grant: AutomationFolderGrant,
    options: { include?: string[] },
  ): Promise<ScriptFileEntry[]>;
  stat(
    grant: AutomationFolderGrant,
    relativePath: string,
  ): Promise<ScriptFileEntry | null>;
  readText(
    grant: AutomationFolderGrant,
    relativePath: string,
    maxBytes: number,
  ): Promise<string>;
}

export interface ScriptRunInput {
  source: string;
  cursor: PineJsonValue | null;
  now: Date;
  secrets: Record<string, string>;
  network: readonly string[];
  read: readonly AutomationFolderGrant[];
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  fs: ScriptFileSystem;
  signal?: AbortSignal;
}

export interface ScriptRequestRecord {
  url: string;
  status?: number;
  error?: string;
}

export interface ScriptRunResult {
  events: { id: string; data: PineJsonValue }[];
  cursor?: PineJsonValue;
  logs: string[];
  requests: ScriptRequestRecord[];
  durationMs: number;
}

export class ScriptRunError extends Error {
  constructor(
    message: string,
    readonly logs: string[],
    readonly requests: ScriptRequestRecord[],
  ) {
    super(message);
  }
}

let quickJs: Promise<QuickJSWASMModule> | undefined;

function loadQuickJs(): Promise<QuickJSWASMModule> {
  quickJs ??= newQuickJSWASMModuleFromVariant(variant);
  return quickJs;
}

// The only bridge into the VM. Every host call takes and returns JSON text,
// so no host object or function ever reaches script code.
const PRELUDE = `
const bridge = globalThis.__pine;
delete globalThis.__pine;
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const call = async (name, ...args) => JSON.parse(await bridge[name](...args.map((arg) => JSON.stringify(arg ?? null))));
globalThis.__pineContext = (input) => freeze({
  cursor: input.cursor,
  now: input.now,
  secrets: input.secrets,
  fetch: async (url, init) => {
    const response = await call("fetch", String(url), init ?? {});
    return freeze({
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      url: response.url,
      headers: response.headers,
      text: async () => response.body,
      json: async () => JSON.parse(response.body),
    });
  },
  fs: {
    list: (grant, options) => call("fsList", grant, options ?? {}),
    stat: (grant, path) => call("fsStat", grant, String(path)),
    readText: (grant, path) => call("fsRead", grant, String(path)),
  },
  parse: {
    xml: (text) => JSON.parse(bridge.parseXml(String(text))),
    csv: (text) => JSON.parse(bridge.parseCsv(String(text))),
  },
  log: (...values) => bridge.log(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ")),
});
`;

function grantMatches(
  allowed: readonly AutomationFolderGrant[],
  requested: unknown,
): AutomationFolderGrant {
  if (
    !requested ||
    typeof requested !== "object" ||
    typeof (requested as AutomationFolderGrant).folderId !== "string"
  )
    throw new Error('Pass a folder grant such as { folderId: "docs" }.');
  const grant = requested as AutomationFolderGrant;
  const normalize = (value?: string) => (value ?? "").replace(/^\/+|\/+$/g, "");
  const match = allowed.find(
    (candidate) =>
      candidate.folderId === grant.folderId &&
      normalize(candidate.path) === normalize(grant.path),
  );
  if (!match)
    throw new Error(
      `The script may not read folder ${grant.folderId}${grant.path ? `/${grant.path}` : ""}.`,
    );
  return match;
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("The response is larger than 5 MiB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function hostAllowed(network: readonly string[], url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return network.some((allowed) => allowed.toLowerCase() === host);
}

async function scriptFetch(
  input: ScriptRunInput,
  rawUrl: string,
  rawInit: unknown,
  signal: AbortSignal,
): Promise<{
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}> {
  const init = (rawInit ?? {}) as {
    method?: unknown;
    headers?: unknown;
    body?: unknown;
  };
  const headers: Record<string, string> = {};
  if (init.headers && typeof init.headers === "object")
    for (const [key, value] of Object.entries(init.headers))
      headers[key] = String(value);
  const method = typeof init.method === "string" ? init.method : "GET";
  const body = typeof init.body === "string" ? init.body : undefined;
  let url = new URL(rawUrl);
  for (let redirect = 0; ; redirect += 1) {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error(`Only http and https are allowed: ${url.href}`);
    if (!hostAllowed(input.network, url))
      throw new Error(`The script may not access ${url.hostname}.`);
    const response = await input.fetch(url.href, {
      method,
      headers,
      ...(body !== undefined && method !== "GET" && method !== "HEAD"
        ? { body }
        : {}),
      redirect: "manual",
      signal,
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirect >= SCRIPT_LIMITS.redirects)
        throw new Error("Too many redirects.");
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return {
      status: response.status,
      url: url.href,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readLimited(response, SCRIPT_LIMITS.responseBytes),
    };
  }
}

function validateResult(value: unknown): {
  events: { id: string; data: PineJsonValue }[];
  cursor?: PineJsonValue;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("poll() must return { events, cursor }.");
  const result = value as { events?: unknown; cursor?: unknown };
  if (!Array.isArray(result.events))
    throw new Error("poll() must return an events array.");
  if (result.events.length > SCRIPT_LIMITS.events)
    throw new Error(
      `poll() returned more than ${SCRIPT_LIMITS.events} events.`,
    );
  const events = result.events.map((event: unknown, index) => {
    if (!event || typeof event !== "object")
      throw new Error(`events[${index}] must be an object.`);
    const { id, data } = event as { id?: unknown; data?: unknown };
    if (typeof id !== "string" || id.length === 0 || id.length > 500)
      throw new Error(`events[${index}].id must be a non-empty string.`);
    return { id, data: (data ?? null) as PineJsonValue };
  });
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") > SCRIPT_LIMITS.resultBytes
  )
    throw new Error("poll() returned more than 256 KiB.");
  return {
    events,
    ...("cursor" in result
      ? { cursor: (result.cursor ?? null) as PineJsonValue }
      : {}),
  };
}

/** Checks that the source is a module with a default export function. */
export async function checkScriptSyntax(
  source: string,
): Promise<string | undefined> {
  const module = await loadQuickJs();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes);
  const deadline = Date.now() + 2_000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    // compileOnly checks syntax without running the module body.
    const result = vm.evalCode(source, "poll.js", {
      type: "module",
      compileOnly: true,
    });
    if (result.error) {
      const error = vm.dump(result.error) as { message?: string };
      result.error.dispose();
      return error?.message ?? "The script does not compile.";
    }
    result.value.dispose();
    return /export\s+default\s+(async\s+)?function/.test(source)
      ? undefined
      : "The script must `export default async function poll(ctx)`.";
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

/** Runs one poll in a fresh QuickJS runtime with only `ctx` available. */
export async function runScript(
  input: ScriptRunInput,
): Promise<ScriptRunResult> {
  const started = Date.now();
  const logs: string[] = [];
  const requests: ScriptRequestRecord[] = [];
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("The script ran longer than 30 seconds.")),
    SCRIPT_LIMITS.timeoutMs,
  );
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const module = await loadQuickJs();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes);
  runtime.setMaxStackSize(SCRIPT_LIMITS.stackBytes);
  runtime.setInterruptHandler(() => controller.signal.aborted);
  const vm = runtime.newContext();
  const handles: QuickJSHandle[] = [];
  const track = (handle: QuickJSHandle) => {
    handles.push(handle);
    return handle;
  };
  let disposed = false;

  const asyncBridge = (
    name: string,
    run: (...args: unknown[]) => Promise<unknown>,
  ) =>
    track(
      vm.newFunction(name, (...argHandles) => {
        const args = argHandles.map((handle) =>
          JSON.parse(vm.getString(handle)),
        );
        const deferred = vm.newPromise();
        void run(...args).then(
          (value) => {
            if (disposed) return;
            const text = vm.newString(JSON.stringify(value ?? null));
            deferred.resolve(text);
            text.dispose();
            deferred.dispose();
            runtime.executePendingJobs();
          },
          (error: unknown) => {
            if (disposed) return;
            const message = vm.newError(
              error instanceof Error ? error.message : String(error),
            );
            deferred.reject(message);
            message.dispose();
            deferred.dispose();
            runtime.executePendingJobs();
          },
        );
        return deferred.handle;
      }),
    );

  const syncBridge = (name: string, run: (text: string) => string) =>
    track(
      vm.newFunction(name, (handle) => {
        try {
          return vm.newString(run(vm.getString(handle)));
        } catch (error) {
          return {
            error: vm.newError(
              error instanceof Error ? error.message : String(error),
            ),
          };
        }
      }),
    );

  try {
    const bridge = track(vm.newObject());
    vm.setProp(
      bridge,
      "fetch",
      asyncBridge("fetch", async (url, init) => {
        if (requests.length >= SCRIPT_LIMITS.requests)
          throw new Error(
            `A poll may make at most ${SCRIPT_LIMITS.requests} requests.`,
          );
        const record: ScriptRequestRecord = { url: String(url) };
        requests.push(record);
        try {
          const response = await scriptFetch(
            input,
            String(url),
            init,
            controller.signal,
          );
          record.status = response.status;
          return response;
        } catch (error) {
          record.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }),
    );
    vm.setProp(
      bridge,
      "fsList",
      asyncBridge("fsList", (grant, options) =>
        input.fs.list(grantMatches(input.read, grant), {
          include: Array.isArray((options as { include?: unknown })?.include)
            ? (options as { include: unknown[] }).include.map(String)
            : undefined,
        }),
      ),
    );
    vm.setProp(
      bridge,
      "fsStat",
      asyncBridge("fsStat", (grant, relativePath) =>
        input.fs.stat(grantMatches(input.read, grant), String(relativePath)),
      ),
    );
    vm.setProp(
      bridge,
      "fsRead",
      asyncBridge("fsRead", (grant, relativePath) =>
        input.fs.readText(
          grantMatches(input.read, grant),
          String(relativePath),
          SCRIPT_LIMITS.readTextBytes,
        ),
      ),
    );
    vm.setProp(
      bridge,
      "parseXml",
      syncBridge("parseXml", (text) => JSON.stringify(parseXml(text))),
    );
    vm.setProp(
      bridge,
      "parseCsv",
      syncBridge("parseCsv", (text) => JSON.stringify(parseCsv(text))),
    );
    vm.setProp(
      bridge,
      "log",
      track(
        vm.newFunction("log", (handle) => {
          if (logs.length < SCRIPT_LIMITS.logLines)
            logs.push(
              vm.getString(handle).slice(0, SCRIPT_LIMITS.logLineChars),
            );
        }),
      ),
    );
    vm.setProp(vm.global, "__pine", bridge);
    vm.unwrapResult(vm.evalCode(PRELUDE, "prelude.js")).dispose();

    const evaluated = vm.evalCode(input.source, "poll.js", { type: "module" });
    if (evaluated.error) throw new Error(describeVmError(vm, evaluated.error));
    const namespace = track(evaluated.value);
    const state = vm.getPromiseState(namespace);
    const exports = state.type === "fulfilled" ? track(state.value) : namespace;
    const poll = track(vm.getProp(exports, "default"));
    if (vm.typeof(poll) !== "function")
      throw new Error(
        "The script must `export default async function poll(ctx)`.",
      );
    const makeContext = track(vm.getProp(vm.global, "__pineContext"));
    const contextInput = track(
      vm.unwrapResult(
        vm.evalCode(
          `(${JSON.stringify({
            cursor: input.cursor,
            now: input.now.toISOString(),
            secrets: input.secrets,
          })})`,
          "input.js",
        ),
      ),
    );
    const context = track(
      vm.unwrapResult(vm.callFunction(makeContext, vm.undefined, contextInput)),
    );
    const called = vm.callFunction(poll, vm.undefined, context);
    if (called.error) throw new Error(describeVmError(vm, called.error));
    const promise = track(called.value);
    const settled = vm.resolvePromise(promise);
    runtime.executePendingJobs();
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason as Error);
      controller.signal.addEventListener(
        "abort",
        () => reject(controller.signal.reason as Error),
        { once: true },
      );
    });
    const outcome = await Promise.race([settled, aborted]);
    if (outcome.error) throw new Error(describeVmError(vm, outcome.error));
    const resultHandle = track(outcome.value);
    const value: unknown = vm.dump(resultHandle);
    return {
      ...validateResult(value),
      logs,
      requests,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    throw new ScriptRunError(
      error instanceof Error ? error.message : String(error),
      logs,
      requests,
    );
  } finally {
    disposed = true;
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abortFromCaller);
    controller.abort();
    for (const handle of handles.reverse()) if (handle.alive) handle.dispose();
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A promise the script left pending can keep objects alive; the
      // runtime is discarded either way.
    }
  }
}

function describeVmError(vm: QuickJSContext, handle: QuickJSHandle): string {
  const error = vm.dump(handle) as { name?: string; message?: string } | string;
  handle.dispose();
  if (typeof error === "string") return error;
  if (error?.message === "interrupted")
    return "The script ran longer than 30 seconds.";
  return `${error?.name ?? "Error"}: ${error?.message ?? "unknown error"}`;
}
