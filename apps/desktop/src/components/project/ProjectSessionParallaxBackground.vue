<script setup lang="ts">
import {
  BriefcaseBusinessIcon,
  BotIcon,
  BracesIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  ChartColumnIcon,
  ChartPieIcon,
  ClipboardListIcon,
  Code2Icon,
  ContactRoundIcon,
  CpuIcon,
  DatabaseIcon,
  FileCode2Icon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderTreeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HandshakeIcon,
  ListTodoIcon,
  MailIcon,
  MessageCircleIcon,
  NotebookPenIcon,
  PanelLeftIcon,
  PresentationIcon,
  PrinterIcon,
  ReceiptTextIcon,
  SearchCodeIcon,
  ShieldCheckIcon,
  SignatureIcon,
  SparklesIcon,
  TerminalIcon,
  UsersIcon,
  WorkflowIcon,
  WrenchIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  ParallaxFloat,
  ParallaxFloatElement,
} from "@/components/ui/parallax-float";
import { cn } from "@/lib/utils";

interface ParallaxIcon {
  id: string;
  icon: Component;
  x: string;
  y: string;
  depth: number;
  opacity: number;
  size: "size-12" | "size-14" | "size-16" | "size-20";
  iconSize: "size-8" | "size-10" | "size-12";
  fadeDelay: number;
}

const FADE_STEP_MS = 20;
const FADE_DURATION_MS = 900;
const ICON_BLUR_PX = 8;
const isRevealed = ref(false);

function inwardPosition(position: string): string {
  return `${50 + (Number.parseFloat(position) - 50) * 0.85}%`;
}

const iconSizeClasses: Record<ParallaxIcon["iconSize"], string> = {
  "size-8": "[&_svg]:size-8",
  "size-10": "[&_svg]:size-10",
  "size-12": "[&_svg]:size-12",
};

interface IconDefinition {
  id: string;
  icon: Component;
}

interface PositionSlot {
  x: string;
  y: string;
}

const parallaxIconDefinitions: readonly IconDefinition[] = [
  {
    id: "agent",
    icon: BotIcon,
  },
  {
    id: "code",
    icon: Code2Icon,
  },
  {
    id: "workflow",
    icon: WorkflowIcon,
  },
  {
    id: "terminal",
    icon: TerminalIcon,
  },
  {
    id: "files",
    icon: FolderTreeIcon,
  },
  {
    id: "branch",
    icon: GitBranchIcon,
  },
  {
    id: "security",
    icon: ShieldCheckIcon,
  },
  {
    id: "tools",
    icon: WrenchIcon,
  },
  {
    id: "runtime",
    icon: CpuIcon,
  },
  {
    id: "data",
    icon: DatabaseIcon,
  },
  {
    id: "search",
    icon: SearchCodeIcon,
  },
  {
    id: "panels",
    icon: PanelLeftIcon,
  },
  {
    id: "syntax",
    icon: BracesIcon,
  },
  {
    id: "review",
    icon: GitPullRequestIcon,
  },
  {
    id: "file-code",
    icon: FileCode2Icon,
  },
  {
    id: "spark",
    icon: SparklesIcon,
  },
  { id: "documents", icon: FileTextIcon },
  { id: "spreadsheets", icon: FileSpreadsheetIcon },
  { id: "presentations", icon: PresentationIcon },
  { id: "mail", icon: MailIcon },
  { id: "calendar", icon: CalendarDaysIcon },
  { id: "checklist", icon: ClipboardListIcon },
  { id: "tasks", icon: ListTodoIcon },
  { id: "charts", icon: ChartColumnIcon },
  { id: "reports", icon: ChartPieIcon },
  { id: "team", icon: UsersIcon },
  { id: "business", icon: BriefcaseBusinessIcon },
  { id: "notes", icon: NotebookPenIcon },
  { id: "contacts", icon: ContactRoundIcon },
  { id: "messages", icon: MessageCircleIcon },
  { id: "folders", icon: FolderOpenIcon },
  { id: "print", icon: PrinterIcon },
  { id: "sign", icon: SignatureIcon },
  { id: "receipts", icon: ReceiptTextIcon },
  { id: "calculate", icon: CalculatorIcon },
  { id: "collaboration", icon: HandshakeIcon },
];

/** Fixed positions keep the composition art-directed while each visual
 * parameter is shuffled independently, so no slot implies a depth or size. */
// Offset rows keep the composition loose while balancing eight icons on each
// side and leaving the central copy and bottom composer clear.
const parallaxSlots: readonly PositionSlot[] = [
  { x: "15%", y: "18%" },
  { x: "34%", y: "15%" },
  { x: "66%", y: "16%" },
  { x: "85%", y: "20%" },
  { x: "10%", y: "39%" },
  { x: "28%", y: "35%" },
  { x: "74%", y: "36%" },
  { x: "90%", y: "42%" },
  { x: "11%", y: "62%" },
  { x: "27%", y: "66%" },
  { x: "73%", y: "65%" },
  { x: "89%", y: "60%" },
  { x: "18%", y: "81%" },
  { x: "38%", y: "79%" },
  { x: "64%", y: "80%" },
  { x: "83%", y: "82%" },
];

const depthValues = [
  0.28, 0.32, 0.4, 0.65, 0.7, 0.75, 0.85, 1.15, 1.2, 1.35, 1.4, 1.55, 1.8, 2.1,
  2.4, 3.8,
];

const MIN_ICON_OPACITY = 0.1;
const MAX_ICON_OPACITY = 0.55;

const iconScaleOptions: readonly Pick<ParallaxIcon, "size" | "iconSize">[] = [
  { size: "size-12", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-12" },
  { size: "size-20", iconSize: "size-12" },
  { size: "size-12", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-10" },
  { size: "size-20", iconSize: "size-12" },
  { size: "size-14", iconSize: "size-8" },
  { size: "size-16", iconSize: "size-12" },
  { size: "size-12", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-10" },
  { size: "size-14", iconSize: "size-8" },
];

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

/** Spreads opacity evenly across the depth ranking, so icons whose depths sit
 * close together still read at clearly different strengths. */
function opacityForRank(rank: number, count: number): number {
  if (count <= 1) return MAX_ICON_OPACITY;
  return (
    MIN_ICON_OPACITY +
    (rank / (count - 1)) * (MAX_ICON_OPACITY - MIN_ICON_OPACITY)
  );
}

const selectedIcons = shuffle(parallaxIconDefinitions).slice(
  0,
  parallaxSlots.length,
);
const shuffledDepths = shuffle(depthValues);
const depthRanks = new Map<number, number>(
  [...shuffledDepths]
    .sort((first, second) => first - second)
    .map((depth, rank): [number, number] => [depth, rank]),
);
const shuffledScales = shuffle(iconScaleOptions);
const parallaxIcons: readonly ParallaxIcon[] = parallaxSlots.map(
  (slot, index) => {
    const depth = shuffledDepths[index];
    return {
      ...selectedIcons[index],
      ...slot,
      depth,
      opacity: opacityForRank(
        depthRanks.get(depth) ?? 0,
        shuffledDepths.length,
      ),
      ...shuffledScales[index],
      fadeDelay: 0,
    };
  },
);

const fadeOrder = new Map(
  [...parallaxIcons]
    .sort((first, second) => first.depth - second.depth)
    .map((item, index) => [item.id, index]),
);
const parallaxIconsWithFade: readonly ParallaxIcon[] = parallaxIcons.map(
  (item) => ({
    ...item,
    fadeDelay: (fadeOrder.get(item.id) ?? 0) * FADE_STEP_MS,
  }),
);

let revealFrame: number | undefined;
onMounted(() => {
  revealFrame = window.requestAnimationFrame(() => {
    revealFrame = undefined;
    isRevealed.value = true;
  });
});

onBeforeUnmount(() => {
  if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
});
</script>

<template>
  <div
    aria-hidden="true"
    data-slot="session-parallax-background"
    class="pointer-events-none absolute inset-0 overflow-hidden"
  >
    <!-- Icons barely drift up and down, so vertical pointer travel is damped
    hard while horizontal travel keeps its full range. -->
    <ParallaxFloat
      class="absolute inset-0"
      :easing-factor="0.05"
      :sensitivity="-0.25"
      :vertical-resistance="0.15"
    >
      <ParallaxFloatElement
        v-for="item in parallaxIconsWithFade"
        :key="item.id"
        :data-parallax-icon="item.id"
        :depth="item.depth"
        :style="{
          left: isRevealed ? item.x : inwardPosition(item.x),
          top: isRevealed ? item.y : inwardPosition(item.y),
          opacity: isRevealed ? item.opacity : 0,
          scale: isRevealed ? 1 : 0.92,
          filter: `blur(${isRevealed ? 0 : ICON_BLUR_PX}px)`,
          transitionDelay: isRevealed ? `${item.fadeDelay}ms` : '0ms',
          transitionDuration: `${FADE_DURATION_MS}ms`,
          transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        }"
        :class="
          cn(
            'flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-primary transition-[left,top,opacity,scale,filter] motion-reduce:transition-none',
            item.size,
            iconSizeClasses[item.iconSize],
          )
        "
      >
        <component :is="item.icon" />
      </ParallaxFloatElement>
    </ParallaxFloat>
  </div>
</template>
