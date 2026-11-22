import type { Component } from "vue";
import type { HelpIllustrationId } from "@/app/help";
import ApprovalCardIllustration from "./ApprovalCardIllustration.vue";
import ApprovalModesIllustration from "./ApprovalModesIllustration.vue";
import ContextCompactionIllustration from "./ContextCompactionIllustration.vue";
import ContextFillIllustration from "./ContextFillIllustration.vue";
import ContextTokensIllustration from "./ContextTokensIllustration.vue";
import ModelPickerIllustration from "./ModelPickerIllustration.vue";
import ModelProviderIllustration from "./ModelProviderIllustration.vue";
import ProviderConnectIllustration from "./ProviderConnectIllustration.vue";
import ReasoningLevelsIllustration from "./ReasoningLevelsIllustration.vue";
import ReasoningThinkIllustration from "./ReasoningThinkIllustration.vue";
import ProjectFoldersIllustration from "./ProjectFoldersIllustration.vue";
import SandboxIllustration from "./SandboxIllustration.vue";
import SteerMessageIllustration from "./SteerMessageIllustration.vue";
import StopTurnIllustration from "./StopTurnIllustration.vue";
import TipsIllustration from "./TipsIllustration.vue";
import ToolCallIllustration from "./ToolCallIllustration.vue";

/**
 * Each guide step's picture: small Vue components drawn with theme tokens,
 * so they follow light and dark mode and the accent colour, and hold still
 * with reduced motion.
 */
export const HELP_ILLUSTRATIONS: Record<HelpIllustrationId, Component> = {
  "tool-call": ToolCallIllustration,
  "approval-modes": ApprovalModesIllustration,
  "approval-card": ApprovalCardIllustration,
  "context-fill": ContextFillIllustration,
  "context-tokens": ContextTokensIllustration,
  "context-compaction": ContextCompactionIllustration,
  "model-provider": ModelProviderIllustration,
  "provider-connect": ProviderConnectIllustration,
  "model-picker": ModelPickerIllustration,
  "reasoning-think": ReasoningThinkIllustration,
  "reasoning-levels": ReasoningLevelsIllustration,
  "steer-message": SteerMessageIllustration,
  "stop-turn": StopTurnIllustration,
  "project-folders": ProjectFoldersIllustration,
  sandbox: SandboxIllustration,
  tips: TipsIllustration,
};
