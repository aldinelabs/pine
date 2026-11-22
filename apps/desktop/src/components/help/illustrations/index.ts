import type { Component } from "vue";
import type { HelpIllustrationId } from "@/app/help";
import ApprovalCardIllustration from "./ApprovalCardIllustration.vue";
import ApprovalModesIllustration from "./ApprovalModesIllustration.vue";
import ContextCompactionIllustration from "./ContextCompactionIllustration.vue";
import ContextFillIllustration from "./ContextFillIllustration.vue";
import ContextTokensIllustration from "./ContextTokensIllustration.vue";
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
  tips: TipsIllustration,
};
