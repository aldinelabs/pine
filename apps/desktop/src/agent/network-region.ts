/**
 * Environment variable through which main passes the system's preferred
 * languages (BCP 47 tags, comma-separated) to the agent process, which cannot
 * read them itself.
 */
export const SYSTEM_LANGUAGES_ENV = "PINE_SYSTEM_LANGUAGES";

const MAINLAND_CHINA_TIME_ZONES = new Set([
  "Asia/Shanghai",
  "Asia/Urumqi",
  "Asia/Chongqing",
  "Asia/Chungking",
  "Asia/Harbin",
  "Asia/Kashgar",
  "PRC",
]);

function regionOf(languageTag: string): string | undefined {
  try {
    return new Intl.Locale(languageTag).maximize().region;
  } catch {
    return undefined;
  }
}

/**
 * Whether local signals hint the user may be in mainland China. Only the time
 * zone and system languages are used: no network lookup. A hit is a reason to
 * ask the user, never a conclusion.
 */
export function mayBeInMainlandChina(
  timeZone: string | undefined,
  languageTags: readonly string[],
): boolean {
  if (timeZone && MAINLAND_CHINA_TIME_ZONES.has(timeZone)) return true;
  return languageTags.some((tag) => regionOf(tag) === "CN");
}

export function localNetworkRegionSignals(
  environment: NodeJS.ProcessEnv = process.env,
): { timeZone: string | undefined; languageTags: string[] } {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languageTags: (environment[SYSTEM_LANGUAGES_ENV] ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export const MAINLAND_CHINA_NETWORK_PROMPT = `## Network region

The time zone or system languages on this computer suggest the user may be in mainland China, where default package registries and download hosts (npm, PyPI, Go modules, crates.io, Docker Hub, Hugging Face, GitHub releases, Homebrew) are often slow or unreachable. This is a guess, not a fact.

- Before the first command in this conversation that installs dependencies or downloads from such hosts, or as soon as one is slow, stalls, or fails with network errors, ask the user once (with ask_user_question when available) whether they are in mainland China and want to use domestic mirrors. Do not switch sources before they confirm, and do not ask again in this conversation once they have answered.
- If they confirm, prefer settings scoped to a single command, such as \`--registry\`, \`pip install -i\`, or \`GOPROXY=...\` on that command, over editing configuration. Ask before writing project or global configuration such as \`.npmrc\`, \`pip.conf\`, or \`~/.cargo/config.toml\`.
- Use well-known mirrors such as npmmirror, TUNA, or Aliyun, and tell the user which one you chose.
- If the user is not in mainland China, or says downloads are already fast (for example through a proxy), keep the default sources.`;

/** The prompt section for this machine, or undefined when it does not apply. */
export function networkRegionSystemPrompt(signals: {
  timeZone: string | undefined;
  languageTags: readonly string[];
}): string | undefined {
  return mayBeInMainlandChina(signals.timeZone, signals.languageTags)
    ? MAINLAND_CHINA_NETWORK_PROMPT
    : undefined;
}
