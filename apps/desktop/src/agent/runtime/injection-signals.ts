/**
 * Deterministic prompt-injection and high-risk-action signals for the
 * automatic reviewer. Everything here is a hint for the reviewer, plus one
 * narrow floor (see `injectionFloor`): a signal alone never denies a call.
 *
 * Patterns follow published agent attacks: hidden Unicode instructions,
 * forged conversation/tool boundaries, notes addressed to the reviewer,
 * claimed user authorization, exfiltration sinks (HTTP uploads, DNS, paste
 * and webhook collectors, foreign git remotes), obfuscated execution, and
 * persistence through shell, git or agent configuration.
 */

export type InjectionSignalKind =
  | "hidden-characters"
  | "forged-boundary"
  | "instruction-override"
  | "addressed-to-ai"
  | "claimed-authorization";

export interface InjectionSignal {
  kind: InjectionSignalKind;
  /** Short visible excerpt around the match (hidden characters revealed). */
  excerpt: string;
}

export type ActionRiskKind =
  | "hidden-characters"
  | "data-upload"
  | "exfiltration-host"
  | "dns-with-data"
  | "foreign-git-remote"
  | "obfuscated-execution"
  | "persistence"
  | "agent-config";

export interface ActionRiskSignal {
  kind: ActionRiskKind;
  /** The matched text, used to check whether the user named it. */
  match: string;
}

// Unicode tag characters smuggle invisible ASCII (U+E0020–U+E007E).
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]+/gu;
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
const ZERO_WIDTH = /[​-‍⁠᠎﻿]/g;
// SGR colour codes are ordinary terminal output and carry no text.
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
const ANSI_OTHER =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;

export interface RevealedText {
  text: string;
  /** Tag characters or bidirectional overrides were present. */
  hasStrongHidden: boolean;
  zeroWidthCount: number;
}

/** Makes invisible content visible to the reviewer instead of silently passing it. */
export function revealHiddenCharacters(value: string): RevealedText {
  let hasStrongHidden = false;
  let zeroWidthCount = 0;
  const text = value
    .replace(TAG_CHARACTERS, (run) => {
      hasStrongHidden = true;
      const decoded = [...run]
        .map((character) => {
          const code = character.codePointAt(0)! - 0xe0000;
          return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : "";
        })
        .join("");
      return `⟦hidden tag text: ${JSON.stringify(decoded)}⟧`;
    })
    .replace(BIDI_CONTROLS, (character) => {
      hasStrongHidden = true;
      return `⟦U+${character.codePointAt(0)!.toString(16).toUpperCase()}⟧`;
    })
    .replace(ZERO_WIDTH, () => {
      zeroWidthCount += 1;
      return "⟦ZW⟧";
    })
    .replace(ANSI_SGR, "")
    .replace(ANSI_OTHER, "⟦ESC⟧");
  return { text, hasStrongHidden, zeroWidthCount };
}

interface TextPattern {
  kind: Exclude<InjectionSignalKind, "hidden-characters">;
  regex: RegExp;
}

const INJECTION_PATTERNS: TextPattern[] = [
  {
    kind: "forged-boundary",
    regex:
      /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<\/?(?:system|system[-_]reminder|user|assistant|human|tool_result|tool_results|function_results|function_calls|user_authority|untrusted_data)\b[^>]{0,40}>/i,
  },
  {
    kind: "instruction-override",
    regex:
      /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your|system)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules|guidelines|directions)\b|\byou are now\b|\bnew (?:system )?instructions?\s*:/i,
  },
  {
    kind: "instruction-override",
    regex:
      /(?:忽略|无视|忘记|忽视)(?:掉)?(?:之前|以上|先前|上面|前面|所有|全部)?的?(?:所有|全部)?(?:指令|指示|提示词?|规则|要求)|你现在是|新的(?:系统)?指令[:：]/,
  },
  {
    kind: "addressed-to-ai",
    regex:
      /\b(?:note|message|instructions?|attention|important)\s+(?:to|for)\s+(?:the\s+|any\s+|all\s+)?(?:ai|llms?|assistants?|agents?|models?|(?:security\s+|auto-?)?reviewers?|approvers?|monitors?|claude|gpt|copilot|cursor)\b|\b(?:ai|llm|coding)\s+(?:agents?|assistants?|models?)\s*[:,]\s*(?:please\s+)?(?:run|execute|ignore|send|delete|call|approve|upload|fetch)\b/i,
  },
  {
    kind: "addressed-to-ai",
    regex:
      /(?:致|给|对|告诉)\s*(?:所有)?\s*(?:AI|ai|人工智能|智能体|助手|大模型|模型|审核(?:器|员)|审查(?:者|器))\s*(?:助手|智能体|代理|模型)?\s*[:：，,]/,
  },
  {
    kind: "claimed-authorization",
    regex:
      /\b(?:the\s+)?user\s+(?:has\s+)?(?:already\s+|explicitly\s+)?(?:pre-?)?(?:authori[sz]ed|approved|consented to|granted permission)\b|\b(?:pre-?approved|already (?:been )?approved|approved by (?:the )?(?:admin|administrator|user|owner|security team))\b|\bdo not (?:ask|tell|inform|notify|alert|mention (?:this )?to)\b[^.\n]{0,20}\b(?:the )?(?:user|human)\b/i,
  },
  {
    kind: "claimed-authorization",
    regex:
      /(?:用户|管理员|主人)(?:已经|已)(?:授权|批准|同意|确认)|(?:不要|无需|不必|别)(?:告诉|告知|询问|通知|提醒)(?:用户|主人)/,
  },
];

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Injection-shaped text in untrusted content (tool output, fetched pages). */
export function detectInjectionSignals(value: string): InjectionSignal[] {
  const revealed = revealHiddenCharacters(value);
  const text = revealed.text;
  const signals: InjectionSignal[] = [];
  if (revealed.hasStrongHidden || revealed.zeroWidthCount >= 3) {
    const index = text.search(/⟦(?:hidden tag text|U\+|ZW)/);
    signals.push({
      kind: "hidden-characters",
      excerpt: excerptAround(text, Math.max(0, index), 40),
    });
  }
  for (const { kind, regex } of INJECTION_PATTERNS) {
    if (signals.some((signal) => signal.kind === kind)) continue;
    const match = regex.exec(text);
    if (match) {
      signals.push({
        kind,
        excerpt: excerptAround(text, match.index, match[0].length),
      });
    }
  }
  return signals;
}

interface ActionPattern {
  kind: Exclude<ActionRiskKind, "hidden-characters">;
  regex: RegExp;
}

const EXFILTRATION_HOSTS =
  /\b(?:webhook\.site|requestbin\.\w+|[\w-]+\.pipedream\.net|[\w-]+\.ngrok(?:-free)?\.(?:io|app|dev)|ngrok\.io|[\w.-]*interact\.sh|[\w.-]+\.oast\.(?:pro|live|site|online|fun|me)|[\w.-]*burpcollaborator\.net|canarytokens\.\w+|pastebin\.com|paste\.ee|hastebin\.\w+|transfer\.sh|0x0\.st|termbin\.com|file\.io|requestcatcher\.com|[\w-]+\.beeceptor\.com|hookbin\.com|[\w-]+\.trycloudflare\.com|serveo\.net|[\w-]+\.loca\.lt)\b/i;

const EXFILTRATION_HOSTS_GLOBAL = new RegExp(EXFILTRATION_HOSTS.source, "gi");

const ACTION_PATTERNS: ActionPattern[] = [
  {
    kind: "data-upload",
    regex:
      /\bcurl\b[^;&\n]*\s(?:-d|--data(?:-binary|-raw|-urlencode|-ascii)?|-F|--form)\s*['"]?(?:[\w.-]+=)?@|\bcurl\b[^;&\n]*\s(?:-T|--upload-file)\s|\bwget\b[^;&\n]*--(?:post|body)-file|\|\s*(?:curl|wget|nc|ncat|socat)\b|\b(?:nc|ncat|socat)\b[^;&|\n]*<\s*\S/i,
  },
  { kind: "exfiltration-host", regex: EXFILTRATION_HOSTS },
  {
    kind: "dns-with-data",
    regex:
      /\b(?:nslookup|dig|host|ping|drill)\b[^;&|\n]*(?:\$\(|`|\$\{?[A-Za-z_])/,
  },
  {
    kind: "foreign-git-remote",
    regex:
      /\bgit\s+remote\s+(?:add|set-url)\b[^;&|\n]*|\bgit\s+push\s+(?:-\S+\s+)*(?:https?:\/\/|git@|ssh:\/\/)\S+|\bgh\s+gist\s+create\b/,
  },
  {
    kind: "obfuscated-execution",
    regex:
      /\bbase64\s+(?:-d|--decode|-D)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\beval\s+["'$`(]|\$'(?:\\x[0-9a-fA-F]{2}){3,}|\bxxd\s+-r\b[^;&\n]*\|\s*(?:ba|z)?sh\b|\b(?:python3?|node|perl|ruby)\s+-[ce]\s+['"][^'"]*(?:exec\(|eval\(|b64decode|atob\(|fromCharCode)|\/dev\/(?:tcp|udp)\/|\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby)\b/,
  },
  {
    kind: "persistence",
    regex:
      /\.git\/hooks\/|core\.hooksPath|\.(?:bash|zsh)(?:rc|_profile|env|_login)\b|(?:~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/\.profile\b|\.config\/fish\/|Library\/Launch(?:Agents|Daemons)|\bcrontab\b|\/etc\/cron|authorized_keys|\bsystemctl\s+(?:--user\s+)?enable\b|\blaunchctl\s+(?:load|bootstrap)\b/,
  },
  {
    kind: "agent-config",
    regex:
      /(?:AGENTS|CLAUDE|GEMINI)\.md\b|\.cursorrules\b|\.cursor\/(?:rules|mcp\.json)|\.mcp\.json\b|\.vscode\/(?:settings|tasks|mcp)\.json|\.claude\/settings|\.windsurfrules\b|copilot-instructions\.md|core\.sshCommand|credential\.helper|chat\.tools\.autoApprove|dangerously-skip-permissions/,
  },
];

/** Risky effects visible in the exact reviewed call (command, path or MCP args). */
export function detectActionRisks(subject: string): ActionRiskSignal[] {
  const revealed = revealHiddenCharacters(subject);
  const risks: ActionRiskSignal[] = [];
  if (revealed.hasStrongHidden) {
    risks.push({ kind: "hidden-characters", match: "" });
  }
  for (const { kind, regex } of ACTION_PATTERNS) {
    const match = regex.exec(revealed.text);
    if (match) risks.push({ kind, match: match[0] });
  }
  return risks;
}

/** Network destinations named by a call: URL hosts, scp-style hosts, emails. */
export function extractTargets(subject: string): string[] {
  const targets = new Set<string>();
  for (const match of subject.matchAll(
    /\b[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s'"]+@)?([^/\s'":?#]+)/gi,
  )) {
    targets.add(match[1].toLowerCase());
  }
  for (const match of subject.matchAll(/\bgit@([\w.-]+\.[a-z]{2,}):/gi)) {
    targets.add(match[1].toLowerCase());
  }
  const withoutUrls = subject
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(/\bgit@[\w.-]+:/gi, " ");
  for (const match of withoutUrls.matchAll(
    /\b[\w.+-]+@([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})\b/gi,
  )) {
    targets.add(match[0].toLowerCase());
    targets.add(match[1].toLowerCase());
  }
  for (const match of subject.matchAll(
    /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g,
  )) {
    targets.add(match[0]);
  }
  for (const match of subject.matchAll(EXFILTRATION_HOSTS_GLOBAL)) {
    targets.add(match[0].toLowerCase());
  }
  // Loopback and the machine itself are not destinations that leave it.
  return [...targets].filter(
    (target) =>
      !/^(?:localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/.test(target),
  );
}

/** Risk kinds that do not depend on a destination the user may have named. */
const INHERENTLY_SUSPICIOUS: ReadonlySet<ActionRiskKind> = new Set([
  "hidden-characters",
  "exfiltration-host",
  "dns-with-data",
  "obfuscated-execution",
]);

const GENERIC_PATH_WORDS = new Set([
  "users",
  "home",
  "library",
  "config",
  "etc",
]);

/** A meaningful word from a match that a user would plausibly have written. */
function mentionTerms(
  risk: ActionRiskSignal,
  targets: readonly string[],
): string[] {
  switch (risk.kind) {
    case "hidden-characters":
      return [];
    case "data-upload":
    case "foreign-git-remote":
    case "exfiltration-host":
      return [...targets];
    default: {
      const words = risk.match
        .toLowerCase()
        .split(/[^a-z0-9._-]+/)
        .map((word) => word.replace(/^[._-]+|[._-]+$/g, ""))
        .filter((word) => word.length >= 4 && !GENERIC_PATH_WORDS.has(word));
      return words;
    }
  }
}

export interface InjectionFloorInput {
  subject: string;
  /** Injection signals in untrusted content since the latest user message. */
  turnSignals: readonly InjectionSignal[];
  /** Text of the user's own statements available to the review. */
  userText: string;
}

export interface InjectionFloorHit {
  risks: ActionRiskKind[];
}

/**
 * Pine's deterministic floor beneath the model's verdict. Monitors can be
 * talked out of a denial by the very content they review, so an automatic
 * allow is held back only when all of these hold at once:
 *  - untrusted content read since the user's latest message is injection-shaped;
 *  - the call itself has a high-risk effect (data leaving the machine,
 *    obfuscated execution, persistence or agent-configuration changes);
 *  - the user's own words do not name that effect's target.
 * Hidden tag or bidirectional characters in the call itself always qualify.
 * Ordinary development work never meets all three, so this does not make the
 * reviewer stricter about everyday calls.
 */
export function injectionFloor(
  input: InjectionFloorInput,
): InjectionFloorHit | undefined {
  const risks = detectActionRisks(input.subject);
  if (risks.length === 0) return undefined;
  if (risks.some((risk) => risk.kind === "hidden-characters")) {
    return { risks: risks.map((risk) => risk.kind) };
  }
  if (input.turnSignals.length === 0) return undefined;
  const userText = input.userText.toLowerCase();
  const targets = extractTargets(input.subject);
  const uncovered = risks.filter((risk) => {
    const terms = mentionTerms(risk, targets);
    if (terms.length === 0) return INHERENTLY_SUSPICIOUS.has(risk.kind);
    const mentioned = terms.some((term) => userText.includes(term));
    return !mentioned;
  });
  return uncovered.length > 0
    ? { risks: uncovered.map((risk) => risk.kind) }
    : undefined;
}

/** Keeps untrusted text from closing or forging the reviewer's data blocks. */
export function neutralizeBoundaries(value: string): string {
  return value.replace(/<(\/?)(user_authority|untrusted_data)\b/gi, "‹$1$2");
}
