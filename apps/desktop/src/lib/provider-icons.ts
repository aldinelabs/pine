import ai21Icon from "@lobehub/icons-static-svg/icons/ai21.svg";
import alibabaIcon from "@lobehub/icons-static-svg/icons/alibaba-color.svg";
import baiduIcon from "@lobehub/icons-static-svg/icons/baidu-color.svg";
import bflIcon from "@lobehub/icons-static-svg/icons/bfl.svg";
import byteDanceIcon from "@lobehub/icons-static-svg/icons/bytedance-color.svg";
import cohereIcon from "@lobehub/icons-static-svg/icons/cohere-color.svg";
import hunyuanIcon from "@lobehub/icons-static-svg/icons/hunyuan-color.svg";
import ibmIcon from "@lobehub/icons-static-svg/icons/ibm.svg";
import klingIcon from "@lobehub/icons-static-svg/icons/kling-color.svg";
import metaIcon from "@lobehub/icons-static-svg/icons/meta-color.svg";
import microsoftIcon from "@lobehub/icons-static-svg/icons/microsoft-color.svg";
import novaIcon from "@lobehub/icons-static-svg/icons/nova-color.svg";
import perplexityIcon from "@lobehub/icons-static-svg/icons/perplexity-color.svg";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import stepfunIcon from "@lobehub/icons-static-svg/icons/stepfun-color.svg";
import amazonBedrockIcon from "@lobehub/icons-static-svg/icons/bedrock-color.svg";
import antGroupIcon from "@lobehub/icons-static-svg/icons/antgroup-color.svg";
import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg";
import azureIcon from "@lobehub/icons-static-svg/icons/azure-color.svg";
import cerebrasIcon from "@lobehub/icons-static-svg/icons/cerebras-color.svg";
import cloudflareIcon from "@lobehub/icons-static-svg/icons/cloudflare-color.svg";
import deepSeekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import fireworksIcon from "@lobehub/icons-static-svg/icons/fireworks-color.svg";
import githubCopilotIcon from "@lobehub/icons-static-svg/icons/githubcopilot.svg";
import googleIcon from "@lobehub/icons-static-svg/icons/google-color.svg";
import groqIcon from "@lobehub/icons-static-svg/icons/groq.svg";
import huggingFaceIcon from "@lobehub/icons-static-svg/icons/huggingface-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import moonshotIcon from "@lobehub/icons-static-svg/icons/moonshot.svg";
import nvidiaIcon from "@lobehub/icons-static-svg/icons/nvidia-color.svg";
import openAiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openRouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import togetherIcon from "@lobehub/icons-static-svg/icons/together-color.svg";
import vercelIcon from "@lobehub/icons-static-svg/icons/vercel.svg";
import vertexAiIcon from "@lobehub/icons-static-svg/icons/vertexai-color.svg";
import workersAiIcon from "@lobehub/icons-static-svg/icons/workersai-color.svg";
import xAiIcon from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomiMimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import antgroupMonoIcon from "@lobehub/icons-static-svg/icons/antgroup.svg";
import azureMonoIcon from "@lobehub/icons-static-svg/icons/azure.svg";
import bedrockMonoIcon from "@lobehub/icons-static-svg/icons/bedrock.svg";
import cerebrasMonoIcon from "@lobehub/icons-static-svg/icons/cerebras.svg";
import cloudflareMonoIcon from "@lobehub/icons-static-svg/icons/cloudflare.svg";
import deepseekMonoIcon from "@lobehub/icons-static-svg/icons/deepseek.svg";
import fireworksMonoIcon from "@lobehub/icons-static-svg/icons/fireworks.svg";
import googleMonoIcon from "@lobehub/icons-static-svg/icons/google.svg";
import huggingfaceMonoIcon from "@lobehub/icons-static-svg/icons/huggingface.svg";
import kimiMonoIcon from "@lobehub/icons-static-svg/icons/kimi.svg";
import minimaxMonoIcon from "@lobehub/icons-static-svg/icons/minimax.svg";
import mistralMonoIcon from "@lobehub/icons-static-svg/icons/mistral.svg";
import nvidiaMonoIcon from "@lobehub/icons-static-svg/icons/nvidia.svg";
import openrouterMonoIcon from "@lobehub/icons-static-svg/icons/openrouter.svg";
import togetherMonoIcon from "@lobehub/icons-static-svg/icons/together.svg";
import vertexaiMonoIcon from "@lobehub/icons-static-svg/icons/vertexai.svg";
import workersaiMonoIcon from "@lobehub/icons-static-svg/icons/workersai.svg";
import zhipuMonoIcon from "@lobehub/icons-static-svg/icons/zhipu.svg";

export interface ProviderIconDefinition {
  /** `src` is single-colour (black) and needs inverting on dark surfaces. */
  monochrome?: boolean;
  /** Single-colour (`currentColor`) variant of a colour `src`. */
  monoSrc?: string;
  src: string;
}

/** The icon's single-colour SVG, for drawing in the surrounding text colour. */
export function monoIconSource(icon: ProviderIconDefinition): string {
  return icon.monoSrc ?? icon.src;
}

const PROVIDER_ICONS = {
  ai21: { monochrome: true, src: ai21Icon },
  alibaba: { src: alibabaIcon },
  baidu: { src: baiduIcon },
  bfl: { monochrome: true, src: bflIcon },
  bytedance: { src: byteDanceIcon },
  cohere: { src: cohereIcon },
  hunyuan: { src: hunyuanIcon },
  ibm: { monochrome: true, src: ibmIcon },
  kling: { src: klingIcon },
  meta: { src: metaIcon },
  microsoft: { src: microsoftIcon },
  nova: { src: novaIcon },
  perplexity: { src: perplexityIcon },
  qwen: { src: qwenIcon },
  stepfun: { src: stepfunIcon },
  antgroup: { monoSrc: antgroupMonoIcon, src: antGroupIcon },
  anthropic: { monochrome: true, src: anthropicIcon },
  azure: { monoSrc: azureMonoIcon, src: azureIcon },
  bedrock: { monoSrc: bedrockMonoIcon, src: amazonBedrockIcon },
  cerebras: { monoSrc: cerebrasMonoIcon, src: cerebrasIcon },
  cloudflare: { monoSrc: cloudflareMonoIcon, src: cloudflareIcon },
  deepseek: { monoSrc: deepseekMonoIcon, src: deepSeekIcon },
  fireworks: { monoSrc: fireworksMonoIcon, src: fireworksIcon },
  githubcopilot: { monochrome: true, src: githubCopilotIcon },
  google: { monoSrc: googleMonoIcon, src: googleIcon },
  groq: { monochrome: true, src: groqIcon },
  huggingface: { monoSrc: huggingfaceMonoIcon, src: huggingFaceIcon },
  kimi: { monoSrc: kimiMonoIcon, src: kimiIcon },
  minimax: { monoSrc: minimaxMonoIcon, src: minimaxIcon },
  mistral: { monoSrc: mistralMonoIcon, src: mistralIcon },
  moonshot: { monochrome: true, src: moonshotIcon },
  nvidia: { monoSrc: nvidiaMonoIcon, src: nvidiaIcon },
  openai: { monochrome: true, src: openAiIcon },
  opencode: { monochrome: true, src: opencodeIcon },
  openrouter: { monoSrc: openrouterMonoIcon, src: openRouterIcon },
  together: { monoSrc: togetherMonoIcon, src: togetherIcon },
  vercel: { monochrome: true, src: vercelIcon },
  vertexai: { monoSrc: vertexaiMonoIcon, src: vertexAiIcon },
  workersai: { monoSrc: workersaiMonoIcon, src: workersAiIcon },
  xai: { monochrome: true, src: xAiIcon },
  xiaomimimo: { monochrome: true, src: xiaomiMimoIcon },
  zhipu: { monoSrc: zhipuMonoIcon, src: zhipuIcon },
} as const satisfies Record<string, ProviderIconDefinition>;

type ProviderIconId = keyof typeof PROVIDER_ICONS;

const PROVIDER_ALIASES: Readonly<Record<string, ProviderIconId>> = {
  amazonbedrock: "bedrock",
  antgroup: "antgroup",
  antling: "antgroup",
  anthropic: "anthropic",
  azure: "azure",
  azureopenai: "azure",
  azureopenairesponses: "azure",
  bedrock: "bedrock",
  cerebras: "cerebras",
  cloudflare: "cloudflare",
  cloudflareaigateway: "cloudflare",
  cloudflareworkersai: "workersai",
  deepseek: "deepseek",
  fireworks: "fireworks",
  githubcopilot: "githubcopilot",
  google: "google",
  googlevertex: "vertexai",
  groq: "groq",
  huggingface: "huggingface",
  kimi: "kimi",
  kimicoding: "kimi",
  minimax: "minimax",
  minimaxcn: "minimax",
  mistral: "mistral",
  moonshot: "moonshot",
  moonshotai: "moonshot",
  moonshotaicn: "moonshot",
  nvidia: "nvidia",
  openai: "openai",
  openaicodex: "openai",
  opencode: "opencode",
  opencodego: "opencode",
  openrouter: "openrouter",
  together: "together",
  togetherai: "together",
  vercel: "vercel",
  vercelaigateway: "vercel",
  vertexai: "vertexai",
  workersai: "workersai",
  xai: "xai",
  xiaomi: "xiaomimimo",
  xiaomimimo: "xiaomimimo",
  xiaomitokenplanams: "xiaomimimo",
  xiaomitokenplancn: "xiaomimimo",
  xiaomitokenplansgp: "xiaomimimo",
  zai: "zhipu",
  zaicodingcn: "zhipu",
  zhipu: "zhipu",
};

function normalizeProvider(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]/g, "");
}

export function resolveProviderIcon(
  providerId: string,
  providerName?: string,
): ProviderIconDefinition | undefined {
  const iconId =
    PROVIDER_ALIASES[normalizeProvider(providerId)] ??
    (providerName
      ? PROVIDER_ALIASES[normalizeProvider(providerName)]
      : undefined);
  return iconId ? PROVIDER_ICONS[iconId] : undefined;
}

/**
 * Model vendors as they appear before the `/` in aggregator model IDs
 * (OpenRouter, Vercel AI Gateway, …), normalized like provider IDs.
 */
const VENDOR_ALIASES: Readonly<Record<string, ProviderIconId>> = {
  ...PROVIDER_ALIASES,
  ai21: "ai21",
  alibaba: "alibaba",
  amazon: "nova",
  baidu: "baidu",
  blackforestlabs: "bfl",
  bytedance: "bytedance",
  bytedanceseed: "bytedance",
  cohere: "cohere",
  ibm: "ibm",
  ibmgranite: "ibm",
  kwaivgi: "kling",
  meta: "meta",
  metallama: "meta",
  microsoft: "microsoft",
  mistralai: "mistral",
  perplexity: "perplexity",
  qwen: "qwen",
  stepfun: "stepfun",
  stepfunai: "stepfun",
  tencent: "hunyuan",
  thudm: "zhipu",
};

/** Name prefixes of bare model IDs (no vendor segment), checked in order. */
const MODEL_NAME_PATTERNS: readonly (readonly [RegExp, ProviderIconId])[] = [
  [/^claude/, "anthropic"],
  [/^(gpt|chatgpt|o[134](\b|-|$)|codex|dall-?e|sora|whisper|tts-)/, "openai"],
  [/^(gemini|gemma|imagen|veo|nano-?banana)/, "google"],
  [/^grok/, "xai"],
  [/^deepseek/, "deepseek"],
  [/^(qwen|qwq|qvq|wan\d)/, "qwen"],
  [/^(kimi|moonshot)/, "moonshot"],
  [/^(glm|chatglm|cogview|cogvideo)/, "zhipu"],
  [/^(minimax|abab|hailuo)/, "minimax"],
  [/^(doubao|seed)/, "bytedance"],
  [/^(llama|meta-llama)/, "meta"],
  [
    /^(mistral|mixtral|codestral|devstral|magistral|ministral|pixtral)/,
    "mistral",
  ],
  [/^phi-?\d/, "microsoft"],
  [/^(hunyuan|hy\d)/, "hunyuan"],
  [/^mimo/, "xiaomimimo"],
  [/^ernie/, "baidu"],
  [/^(amazon[.-])?nova/, "nova"],
  [/^command/, "cohere"],
  [/^flux/, "bfl"],
  [/^kling/, "kling"],
  [/^step-?\d/, "stepfun"],
  [/^sonar/, "perplexity"],
  [/^granite/, "ibm"],
];

export interface ModelIconSource {
  id: string;
  name?: string;
  providerId: string;
  providerName?: string;
}

function matchModelName(value: string): ProviderIconId | undefined {
  // OpenRouter display names read "Vendor: Model"; the model part matters.
  const name = (value.split(": ").at(-1) ?? value)
    .trim()
    .toLocaleLowerCase("en-US");
  return MODEL_NAME_PATTERNS.find(([pattern]) => pattern.test(name))?.[1];
}

/**
 * The icon of the vendor that makes a model: the `vendor/` segment of an
 * aggregator ID, then well-known model name prefixes, then — only for bare IDs,
 * which a provider serves under its own name — the provider's icon. An unknown
 * `vendor/` segment does not fall back to the aggregator's logo. `undefined`
 * means callers show their generic icon.
 */
export function resolveModelIcon(
  model: ModelIconSource,
): ProviderIconDefinition | undefined {
  const segments = model.id.split("/").filter(Boolean);
  const hasVendorSegment = segments.length > 1;
  const iconId =
    (hasVendorSegment
      ? VENDOR_ALIASES[normalizeProvider(segments[0] ?? "")]
      : undefined) ??
    matchModelName(segments.at(-1) ?? model.id) ??
    (model.name ? matchModelName(model.name) : undefined);
  if (iconId) return PROVIDER_ICONS[iconId];
  return hasVendorSegment
    ? undefined
    : resolveProviderIcon(model.providerId, model.providerName);
}
