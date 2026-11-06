import { nextTick, onScopeDispose, watch, type Ref } from "vue";
import { easeOutExpo } from "@/lib/animateScroll";
import { DURATION_MS } from "@/lib/motion";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
} from "@/shared/attachments";
import { parseQuoteMessage, serializeQuoteMessage } from "@/shared/quotes";
import { contentBlocksToText } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";

interface Snapshot {
  rect: DOMRect;
  content: HTMLElement;
}
interface Entry {
  message: string;
  snapshot?: Snapshot;
  consumed?: boolean;
}

function canonicalMessage(message: string): string {
  const parsed = parseAttachmentMessage(message);
  const quoted = parseQuoteMessage(parsed.prompt);
  return serializeAttachmentMessage(
    parsed.attachments,
    serializeQuoteMessage(quoted.quotes, quoted.prompt),
  );
}

function transcriptSource(message: PineTranscriptMessage): string {
  return serializeAttachmentMessage(
    message.blocks.flatMap((block) =>
      block.type === "attachments" ? block.attachments : [],
    ),
    serializeQuoteMessage(
      message.blocks.flatMap((block) =>
        block.type === "quotes" ? block.quotes : [],
      ),
      contentBlocksToText(message.blocks),
    ),
  );
}

function transcriptTarget(container: HTMLElement | null, messageId: string) {
  const row = [
    ...(container?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []),
  ].find((node) => node.dataset.messageId === messageId);
  return (
    row?.querySelector<HTMLElement>(
      '[data-slot="user-message-row"] [data-slot="bubble"]',
    ) ?? row?.querySelector<HTMLElement>('[data-slot="message-content"]')
  );
}

/** A fixed visual copy can cross the transcript's clipping boundary. The real
 * destination stays in layout, so the scroller and the agent never wait for it.
 * Follow the destination's rect each frame while the transcript scrolls. The
 * dashed source fades out as the formal message fades in, so the style blends
 * instead of switching on arrival. */
export function flySteeringMessage(
  snapshot: Snapshot,
  target: HTMLElement,
  onFinish?: () => void,
): () => void {
  const overlay = document.createElement("div");
  overlay.dataset.slot = "steering-message-flight";
  overlay.setAttribute("aria-hidden", "true");
  overlay.inert = true;
  Object.assign(overlay.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${snapshot.rect.width}px`,
    height: `${snapshot.rect.height}px`,
    pointerEvents: "none",
    zIndex: "40",
    transformOrigin: "top left",
  });
  const content = snapshot.content;
  for (const node of [content, ...content.querySelectorAll("[id]")])
    node.removeAttribute("id");
  Object.assign(content.style, {
    width: "100%",
    maxWidth: "none",
    margin: "0",
  });
  overlay.append(content);
  document.body.append(overlay);
  const visibility = target.style.visibility;
  const targetOpacity = target.style.opacity;
  target.style.visibility = "hidden";
  target.style.opacity = "0";
  let frame: number | undefined;
  let startedAt: number | undefined;
  let finished = false;
  function cancel(): void {
    if (finished) return;
    finished = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    target.style.visibility = visibility;
    target.style.opacity = targetOpacity;
    overlay.remove();
    window.removeEventListener("wheel", cancel, true);
    window.removeEventListener("touchstart", cancel, true);
    onFinish?.();
  }
  function step(now: number): void {
    if (!target.isConnected) return cancel();
    startedAt ??= now;
    const progress = Math.min(1, (now - startedAt) / DURATION_MS);
    const eased = easeOutExpo(progress);
    const rect = target.getBoundingClientRect();
    const from = snapshot.rect;
    const x = from.left + (rect.left - from.left) * eased;
    const y = from.top + (rect.top - from.top) * eased;
    const sx = 1 + (rect.width / from.width - 1) * eased;
    const sy = 1 + (rect.height / from.height - 1) * eased;
    overlay.style.transform = `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
    // The dashed preview yields to the real message through one shared curve,
    // so the bubble reads as restyled in flight, not swapped at the end.
    overlay.style.opacity = String(1 - eased);
    target.style.opacity = String(eased);
    if (progress === 1) return cancel();
    frame = requestAnimationFrame(step);
  }
  // Position before the first paint rather than briefly flashing at (0, 0).
  overlay.style.transform = `translate(${snapshot.rect.left}px, ${snapshot.rect.top}px)`;
  overlay.style.opacity = "1";
  window.addEventListener("wheel", cancel, { capture: true, passive: true });
  window.addEventListener("touchstart", cancel, {
    capture: true,
    passive: true,
  });
  frame = requestAnimationFrame(step);
  return cancel;
}

/** The arrival half of the flight, for normally sent messages: the same curve
 * reveals the bubble where it lands, with no flying source to blend from. */
export function revealMessage(target: HTMLElement): () => void {
  const previousOpacity = target.style.opacity;
  target.style.opacity = "0";
  let frame: number | undefined;
  let startedAt: number | undefined;
  let finished = false;
  function cancel(): void {
    if (finished) return;
    finished = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    target.style.opacity = previousOpacity;
  }
  function step(now: number): void {
    if (!target.isConnected) return cancel();
    startedAt ??= now;
    const progress = Math.min(1, (now - startedAt) / DURATION_MS);
    target.style.opacity = String(easeOutExpo(progress));
    if (progress === 1) return cancel();
    frame = requestAnimationFrame(step);
  }
  frame = requestAnimationFrame(step);
  return cancel;
}

/** Match queued messages to newly arrived user messages, including when queue
 * removal and message arrival land in separate IPC batches. Withdrawn messages
 * never animate: without a matching new transcript entry they simply expire. */
export function useSteeringMessageTransition(options: {
  container: Ref<HTMLElement | null>;
  queue: Ref<readonly string[]>;
  messages: Ref<readonly PineTranscriptMessage[]>;
  active: Ref<boolean>;
  sessionId: Ref<string | undefined>;
}): void {
  let queued: Entry[] = [];
  const pending: Entry[] = [];
  const cancellations = new Set<() => void>();
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  function reset(): void {
    generation++;
    queued = [];
    pending.length = 0;
    clearTimeout(expiry);
    for (const cancel of cancellations) cancel();
    cancellations.clear();
  }
  watch([options.active, options.sessionId], reset, { flush: "sync" });
  watch(
    [options.queue, options.messages, options.active, options.sessionId],
    ([queue, messages], previous) => {
      if (
        !options.active.value ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        reset();
        return;
      }
      const container = options.container.value;
      const sourceNodes = container?.querySelectorAll<HTMLElement>(
        "[data-steering-content]",
      );
      queued.forEach((entry, index) => {
        if (entry.consumed) return;
        const source =
          sourceNodes?.[index]?.querySelector<HTMLElement>(
            '[data-slot="bubble"]',
          ) ?? sourceNodes?.[index];
        const rect = source?.getBoundingClientRect();
        if (source && rect && rect.width > 0 && rect.height > 0) {
          entry.snapshot = {
            rect,
            content: source.cloneNode(true) as HTMLElement,
          };
        }
      });
      const unused = [...queued];
      queued = queue.map((message) => {
        const index = unused.findIndex((entry) => entry.message === message);
        return index >= 0 ? unused.splice(index, 1)[0] : { message };
      });
      pending.push(
        ...unused.filter((entry) => !entry.consumed && entry.snapshot),
      );
      if (pending.length) {
        pending.splice(0, Math.max(0, pending.length - 16));
        clearTimeout(expiry);
        expiry = setTimeout(() => {
          pending.length = 0;
        }, 5_000);
      }
      const oldMessages = previous?.[1] ?? [];
      const oldIds = new Set(oldMessages.map((message) => message.id));
      // Pure appends only: loading older history prepends and switching
      // sessions replaces, and neither should play the arrival reveal.
      const appended =
        oldMessages.length > 0 &&
        messages.length > oldMessages.length &&
        oldMessages.every(
          (message, index) => messages[index]?.id === message.id,
        )
          ? messages.slice(oldMessages.length)
          : [];
      const flown = new Set<PineTranscriptMessage>();
      for (const message of messages) {
        if (message.role !== "user" || oldIds.has(message.id)) continue;
        const source = transcriptSource(message);
        const entry = [...pending, ...queued].find(
          (entry) =>
            !entry.consumed &&
            entry.snapshot &&
            canonicalMessage(entry.message) === source,
        );
        if (!entry?.snapshot) continue;
        entry.consumed = true;
        flown.add(message);
        const snapshot = entry.snapshot;
        const currentGeneration = generation;
        void nextTick(() => {
          if (generation !== currentGeneration) return;
          const target = transcriptTarget(container, message.id);
          const rect = target?.getBoundingClientRect();
          if (!target || !rect || rect.width <= 0 || rect.height <= 0) return;
          const cancel = flySteeringMessage(snapshot, target, () =>
            cancellations.delete(cancel),
          );
          cancellations.add(cancel);
        });
      }
      for (const message of appended) {
        if (message.role !== "user" || flown.has(message)) continue;
        const currentGeneration = generation;
        void nextTick(() => {
          if (generation !== currentGeneration) return;
          const target = transcriptTarget(container, message.id);
          if (!target) return;
          const cancel = revealMessage(target);
          cancellations.add(cancel);
        });
      }
    },
    { immediate: true, flush: "pre" },
  );
  onScopeDispose(reset);
}
