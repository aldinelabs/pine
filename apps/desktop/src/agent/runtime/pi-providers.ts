import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  PI_PROVIDER_ID_PREFIX,
  type PiAgentDirSource,
  type PiProviderSkip,
  type PiProvidersFileError,
} from "../../shared/piProviders";

export type ProviderConfigInput = Parameters<
  ModelRuntime["registerProvider"]
>[1];

/** Pi's models.json is small; anything larger is refused rather than parsed. */
export const PI_MODELS_MAX_BYTES = 1024 * 1024;

const PI_APIS = new Set([
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "openai-completions",
  "openai-responses",
]);

export interface PiAgentDirLocation {
  agentDir: string;
  source: PiAgentDirSource;
}

export interface PiProvidersSnapshot {
  modelsPath: string;
  found: boolean;
  /** Keyed by the namespaced Pine provider id (`pi-<key>`). */
  providers: Map<string, ProviderConfigInput>;
  skipped: PiProviderSkip[];
  error?: PiProvidersFileError;
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2));
  }
  return value;
}

/**
 * Pi's agent folder, in the same order CC Switch and Pi use: Pine's own
 * setting, then `PI_CODING_AGENT_DIR`, then `~/.pi/agent`.
 */
export function resolvePiAgentDir(
  override: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): PiAgentDirLocation {
  if (override && path.isAbsolute(expandHome(override, home))) {
    return { agentDir: expandHome(override, home), source: "setting" };
  }
  const fromEnv = env.PI_CODING_AGENT_DIR?.trim();
  if (fromEnv && path.isAbsolute(expandHome(fromEnv, home))) {
    return { agentDir: expandHome(fromEnv, home), source: "environment" };
  }
  return { agentDir: path.join(home, ".pi", "agent"), source: "default" };
}

/** Removes `//` and block comments and trailing commas outside strings. */
export function stripJsonc(input: string): string {
  let output = "";
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === '"') {
      let end = index + 1;
      while (end < input.length && input[end] !== '"') {
        end += input[end] === "\\" ? 2 : 1;
      }
      output += input.slice(index, end + 1);
      index = end + 1;
    } else if (char === "/" && input[index + 1] === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
    } else if (char === "/" && input[index + 1] === "*") {
      const end = input.indexOf("*/", index + 2);
      index = end === -1 ? input.length : end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail) =>
    typeof tail === "string" ? tail : match,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pi runs a value that starts with `!` as a shell command; Pine never does. */
function isCommandValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("!");
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

type ProviderModel = NonNullable<ProviderConfigInput["models"]>[number];

function toModel(
  value: unknown,
  providerApi: string,
  providerCompat: Record<string, unknown> | undefined,
): ProviderModel | "command-value" | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return undefined;
  }
  const headers = stringRecord(value.headers);
  if (headers && Object.values(headers).some(isCommandValue)) {
    return "command-value";
  }
  const api =
    typeof value.api === "string" && PI_APIS.has(value.api)
      ? value.api
      : providerApi;
  const input = Array.isArray(value.input)
    ? value.input.filter(
        (entry): entry is "text" | "image" =>
          entry === "text" || entry === "image",
      )
    : [];
  const modelCompat = isRecord(value.compat) ? value.compat : undefined;
  const compat =
    providerCompat || modelCompat
      ? { ...providerCompat, ...modelCompat }
      : undefined;
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name ? value.name : value.id,
    api,
    ...(typeof value.baseUrl === "string" && value.baseUrl
      ? { baseUrl: value.baseUrl }
      : {}),
    reasoning: value.reasoning === true,
    ...(isRecord(value.thinkingLevelMap)
      ? { thinkingLevelMap: value.thinkingLevelMap }
      : {}),
    input: input.length > 0 ? input : ["text"],
    cost: isRecord(value.cost)
      ? {
          input: Number(value.cost.input) || 0,
          output: Number(value.cost.output) || 0,
          cacheRead: Number(value.cost.cacheRead) || 0,
          cacheWrite: Number(value.cost.cacheWrite) || 0,
        }
      : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: positiveNumber(value.contextWindow) ?? 128_000,
    maxTokens: positiveNumber(value.maxTokens) ?? 16_384,
    ...(headers ? { headers } : {}),
    ...(compat ? { compat } : {}),
  };
}

/**
 * Turns one provider node from Pi's models.json into a provider Pine can
 * register, or the reason it is left out. `!command` keys and headers are
 * refused so Pine never runs a command written by another app; `$ENV` keys
 * stay as they are and pi-ai resolves them from Pine's environment.
 */
export function toPiProviderConfig(
  node: unknown,
): ProviderConfigInput | PiProviderSkip["reason"] {
  if (!isRecord(node)) return "invalid";
  const headers = stringRecord(node.headers);
  if (
    isCommandValue(node.apiKey) ||
    (headers && Object.values(headers).some(isCommandValue))
  ) {
    return "command-value";
  }
  if (!Array.isArray(node.models) || node.models.length === 0) {
    return "no-models";
  }
  if (typeof node.baseUrl !== "string" || !node.baseUrl.trim()) {
    return "missing-base-url";
  }
  if (typeof node.api !== "string" || !PI_APIS.has(node.api)) {
    return "missing-api";
  }
  const providerCompat = isRecord(node.compat) ? node.compat : undefined;
  const models: ProviderModel[] = [];
  for (const entry of node.models) {
    const model = toModel(entry, node.api, providerCompat);
    if (model === "command-value") return "command-value";
    if (!model) return "invalid";
    models.push(model);
  }
  return {
    ...(typeof node.name === "string" && node.name ? { name: node.name } : {}),
    baseUrl: node.baseUrl,
    api: node.api as ProviderConfigInput["api"],
    ...(typeof node.apiKey === "string" && node.apiKey
      ? { apiKey: node.apiKey }
      : {}),
    ...(headers ? { headers } : {}),
    ...(node.authHeader === true ? { authHeader: true } : {}),
    models,
  };
}

/** A Pi provider key as a Pine provider id, e.g. `cc-switch-x` → `pi-cc-switch-x`. */
export function piProviderId(key: string): string {
  return `${PI_PROVIDER_ID_PREFIX}${key}`;
}

export function parsePiModels(
  text: string,
): Pick<PiProvidersSnapshot, "providers" | "skipped" | "error"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    return { providers: new Map(), skipped: [], error: "invalid-json" };
  }
  if (!isRecord(parsed) || !isRecord(parsed.providers)) {
    return { providers: new Map(), skipped: [], error: "invalid-json" };
  }
  const providers = new Map<string, ProviderConfigInput>();
  const skipped: PiProviderSkip[] = [];
  for (const [key, node] of Object.entries(parsed.providers)) {
    if (!key.trim()) continue;
    const config = toPiProviderConfig(node);
    if (typeof config === "string") skipped.push({ key, reason: config });
    else providers.set(piProviderId(key), config);
  }
  return { providers, skipped };
}

/** Reads Pi's models.json without following it past {@link PI_MODELS_MAX_BYTES}. */
export async function readPiProviders(
  agentDir: string,
): Promise<PiProvidersSnapshot> {
  const modelsPath = path.join(agentDir, "models.json");
  let handle;
  try {
    handle = await open(modelsPath, "r");
  } catch (error) {
    const missing =
      isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
    return {
      modelsPath,
      found: false,
      providers: new Map(),
      skipped: [],
      ...(missing ? {} : { error: "unreadable" as const }),
    };
  }
  try {
    const { size } = await handle.stat();
    if (size > PI_MODELS_MAX_BYTES) {
      return {
        modelsPath,
        found: true,
        providers: new Map(),
        skipped: [],
        error: "too-large",
      };
    }
    const text = await handle.readFile("utf8");
    return { modelsPath, found: true, ...parsePiModels(text) };
  } catch {
    return {
      modelsPath,
      found: true,
      providers: new Map(),
      skipped: [],
      error: "unreadable",
    };
  } finally {
    await handle.close();
  }
}
