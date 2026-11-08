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

/** How quickly the copy catches a destination that is still moving. Well
 * inside the flight, so it settles without ever passing the bubble. */
const CHASE_MS = DURATION_MS / 7;
/** Becomes visible only once the copy is most of the way there, so the dashed
 * bubble travels solid and the hand-over happens at the end. */
const BLEND_START = 0.35;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Opacity that is driven by an expo curve reads as a pop: it is nearly opaque
 * after a tenth of the duration. The hand-over needs a curve you can see. */
function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}
function easeOutSine(t: number): number {
  return Math.sin((Math.PI / 2) * t);
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

function transcriptRow(container: HTMLElement | null, messageId: string) {
  return (
    [
      ...(container?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []),
    ].find((node) => node.dataset.messageId === messageId) ?? null
  );
}

function transcriptTarget(container: HTMLElement | null, messageId: string) {
  const row = transcriptRow(container, messageId);
  return (
    row?.querySelector<HTMLElement>(
      '[data-slot="user-message-row"] [data-slot="bubble"]',
    ) ??
    row?.querySelector<HTMLElement>('[data-slot="message-content"]') ??
    row
  );
}

/** Where a message leaves from when it is sent: the row of queued previews
 * above the composer, or the composer itself when nothing is queued. */
function transcriptOrigin(container: HTMLElement | null): DOMRect | null {
  const host =
    container?.querySelector<HTMLElement>(
      '[data-slot="staged-steering-messages"]',
    ) ??
    container?.querySelector<HTMLElement>('[data-slot="session-composer"]');
  return host?.getBoundingClientRect() ?? null;
}

function isMeasurable(
  rect: DOMRect | undefined,
): rect is DOMRect & { width: number; height: number } {
  return !!rect && rect.width > 0 && rect.height > 0;
}

/** The same message can be carrying a transform from the animation itself;
 * measure where it sits in layout instead of where it is painted. */
function measure(node: HTMLElement): DOMRect {
  const transform = node.style.transform;
  if (!transform) return node.getBoundingClientRect();
  node.style.transform = "";
  const rect = node.getBoundingClientRect();
  node.style.transform = transform;
  return rect;
}

/** A fixed visual copy can cross the transcript's clipping boundary. The real
 * destination stays in layout, so the scroller and the agent never wait for it.
 * The destination is re-resolved every frame rather than held by reference: a
 * re-render replaces the bubble, and a stale reference would abort the flight
 * mid-air, leaving the sent message to appear without its hand-over. */
export function flySteeringMessage(
  snapshot: Snapshot,
  resolveTarget: () => HTMLElement | null,
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

  const from = snapshot.rect;
  let held: HTMLElement | null = null;
  let heldOpacity = "";
  let heldTransform = "";
  let heldOrigin = "";
  let x = from.left;
  let y = from.top;
  let width = from.width;
  let height = from.height;
  let frame: number | undefined;
  let startedAt: number | undefined;
  let lastFrame: number | undefined;
  let finished = false;

  /** Keep the formal message in layout but out of sight while its copy flies.
   * Only opacity: hidden visibility would make the hand-over fade invisible,
   * and the message would then pop in when it is restored. */
  function hold(node: HTMLElement): void {
    if (held === node) return;
    release();
    held = node;
    heldOpacity = node.style.opacity;
    heldTransform = node.style.transform;
    heldOrigin = node.style.transformOrigin;
    node.style.opacity = "0";
  }
  function release(): void {
    if (!held) return;
    held.style.opacity = heldOpacity;
    held.style.transform = heldTransform;
    held.style.transformOrigin = heldOrigin;
    held = null;
  }
  function place(): void {
    overlay.style.transform = `translate(${x}px, ${y}px) scale(${width / from.width}, ${height / from.height})`;
  }
  function cancel(): void {
    if (finished) return;
    finished = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    release();
    overlay.remove();
    window.removeEventListener("wheel", cancel, true);
    window.removeEventListener("touchstart", cancel, true);
    onFinish?.();
  }
  function step(now: number): void {
    startedAt ??= now;
    const elapsed = lastFrame === undefined ? 0 : Math.min(64, now - lastFrame);
    lastFrame = now;
    const progress = Math.min(1, (now - startedAt) / DURATION_MS);
    // The dashed preview yields to the real message through one shared curve,
    // so the bubble reads as restyled in flight, not swapped at the end.
    const blend = easeInOutSine(
      clamp01((progress - BLEND_START) / (1 - BLEND_START)),
    );
    overlay.style.opacity = String(1 - blend);
    const node = resolveTarget();
    const rect = node ? measure(node) : undefined;
    if (node && isMeasurable(rect)) {
      hold(node);
      node.style.opacity = String(blend);
      // Catch up with the destination instead of interpolating from where it
      // stood when the flight started: the transcript may still be scrolling
      // or settling, and a copy that keeps its eased lead hands over above or
      // below the bubble it is supposed to become.
      const follow = elapsed > 0 ? 1 - Math.exp(-elapsed / CHASE_MS) : 0;
      x += (rect.left - x) * follow;
      y += (rect.top - y) * follow;
      width += (rect.width - width) * follow;
      height += (rect.height - height) * follow;
      // Carry the real bubble along under the copy, so the hand-over is one
      // object travelling and changing style rather than a message that is
      // already parked while a ghost dissolves above it.
      node.style.transformOrigin = "top left";
      node.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px) scale(${width / rect.width}, ${height / rect.height})`;
      if (progress === 1) {
        // Land exactly on the bubble, so removing the copy never strands the
        // message anywhere else.
        x = rect.left;
        y = rect.top;
        width = rect.width;
        height = rect.height;
        place();
        return cancel();
      }
    } else if (progress === 1) {
      return cancel();
    }
    place();
    frame = requestAnimationFrame(step);
  }

  const initial = resolveTarget();
  if (initial) hold(initial);
  // Position before the first paint rather than briefly flashing at (0, 0).
  overlay.style.opacity = "1";
  place();
  window.addEventListener("wheel", cancel, { capture: true, passive: true });
  window.addEventListener("touchstart", cancel, {
    capture: true,
    passive: true,
  });
  frame = requestAnimationFrame(step);
  return cancel;
}

/** The arrival half of the flight, for normally sent messages: the message
 * itself rises from where a queued preview sits and fades in, so a plain send
 * moves the way a steering hand-over does instead of appearing in place. */
export function revealMessage(
  resolveTarget: () => HTMLElement | null,
  resolveOrigin: () => DOMRect | null = () => null,
): () => void {
  let node: HTMLElement | null = null;
  let originalOpacity = "";
  let originalTransform = "";
  let frame: number | undefined;
  let startedAt: number | undefined;
  let missed = 0;
  let finished = false;
  function cancel(): void {
    if (finished) return;
    finished = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (node) {
      node.style.opacity = originalOpacity;
      node.style.transform = originalTransform;
    }
  }
  function step(now: number): void {
    const target = resolveTarget();
    if (target !== node) {
      // A re-render can replace the bubble; carry the move onto the new node
      // instead of leaving a detached one faded out.
      if (node) {
        node.style.opacity = originalOpacity;
        node.style.transform = originalTransform;
      }
      node = target;
      originalOpacity = node?.style.opacity ?? "";
      originalTransform = node?.style.transform ?? "";
      if (node) node.style.opacity = "0";
    }
    if (!node) {
      // The row may not be mounted yet; wait a few frames rather than
      // dropping the reveal the sent message was supposed to get.
      if (++missed > 30) return cancel();
      frame = requestAnimationFrame(step);
      return;
    }
    startedAt ??= now;
    const progress = Math.min(1, (now - startedAt) / DURATION_MS);
    const rect = measure(node);
    const origin = resolveOrigin();
    if (origin) {
      // Travel on the same curve the copy uses when a steering message lands.
      const remaining = 1 - easeOutExpo(progress);
      const dx = (origin.right - rect.width - rect.left) * remaining;
      const dy = (origin.top - rect.top) * remaining;
      node.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    node.style.opacity = String(easeOutSine(progress));
    if (progress === 1) return cancel();
    frame = requestAnimationFrame(step);
  }
  const initial = resolveTarget();
  if (initial) {
    node = initial;
    originalOpacity = initial.style.opacity;
    originalTransform = initial.style.transform;
    // Hidden before the first paint, so the fade starts from nothing.
    initial.style.opacity = "0";
    const origin = resolveOrigin();
    const rect = measure(initial);
    if (origin) {
      initial.style.transform = `translate(${origin.right - rect.width - rect.left}px, ${origin.top - rect.top}px)`;
    }
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
  /** An edited turn is removed and sent again; its message is a replay of an
   * earlier one, so it should be there at once rather than fly in. */
  let rewritten = false;
  function reset(): void {
    generation++;
    queued = [];
    pending.length = 0;
    rewritten = false;
    clearTimeout(expiry);
    for (const cancel of cancellations) cancel();
    cancellations.clear();
  }
  let reducedMotion: MediaQueryList | undefined;
  function prefersReducedMotion(): boolean {
    reducedMotion ??= window.matchMedia?.("(prefers-reduced-motion: reduce)");
    return reducedMotion?.matches ?? false;
  }
  watch([options.active, options.sessionId], reset, { flush: "sync" });
  watch(
    [options.queue, options.messages, options.active, options.sessionId],
    ([queue, messages], previous) => {
      if (!options.active.value || prefersReducedMotion()) {
        reset();
        return;
      }
      // Only queued previews are measured; skip the DOM query without any.
      const sourceNodes = queued.length
        ? options.container.value?.querySelectorAll<HTMLElement>(
            "[data-steering-content]",
          )
        : undefined;
      // Measure the previews that are on screen right now. The DOM still shows
      // the previous render here, so an entry is measured at its own index in
      // that order, before the queue is rebuilt.
      queued.forEach((entry, index) => {
        if (entry.consumed) return;
        const source =
          sourceNodes?.[index]?.querySelector<HTMLElement>(
            '[data-slot="bubble"]',
          ) ?? sourceNodes?.[index];
        const rect = source?.getBoundingClientRect();
        if (source && isMeasurable(rect)) {
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
      const oldMessages = previous?.[1];
      // A streaming update replaces a message in place. With the same ids in
      // the same order nothing was sent, edited or appended, so the scan over
      // the whole transcript below would find nothing.
      if (
        oldMessages &&
        oldMessages.length === messages.length &&
        messages.every(
          (message, index) => oldMessages[index]?.id === message.id,
        )
      )
        return;
      const oldIds = new Set((oldMessages ?? []).map((message) => message.id));
      // An edit removes the turn from the tail before sending it again.
      if (
        oldMessages &&
        messages.length < oldMessages.length &&
        messages.every(
          (message, index) => oldMessages[index]?.id === message.id,
        )
      ) {
        rewritten = true;
      }
      // Pure appends only: loading older history prepends and switching
      // sessions replaces, and neither should play the arrival reveal.
      const appended =
        oldMessages &&
        messages.length > oldMessages.length &&
        oldMessages.every(
          (message, index) => messages[index]?.id === message.id,
        )
          ? messages.slice(oldMessages.length)
          : [];
      // One message appended to the end is a send. Hydrating a session can
      // also append into an empty list, so a batch is never an arrival.
      const arrived = appended.length === 1 ? appended : [];
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
          const resolveTarget = () =>
            transcriptTarget(options.container.value, message.id);
          const cancel = flySteeringMessage(snapshot, resolveTarget, () =>
            cancellations.delete(cancel),
          );
          cancellations.add(cancel);
        });
      }
      for (const message of arrived) {
        if (message.role !== "user" || flown.has(message)) continue;
        // The edited message is a replay of an earlier turn, not a send.
        if (rewritten) {
          rewritten = false;
          continue;
        }
        const currentGeneration = generation;
        void nextTick(() => {
          if (generation !== currentGeneration) return;
          const resolveTarget = () =>
            transcriptTarget(options.container.value, message.id);
          const cancel = revealMessage(resolveTarget, () =>
            transcriptOrigin(options.container.value),
          );
          cancellations.add(cancel);
        });
      }
    },
    { immediate: true, flush: "pre" },
  );
  onScopeDispose(reset);
}
