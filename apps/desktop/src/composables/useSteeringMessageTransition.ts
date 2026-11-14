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
  /** Stops the preview's own arrival, while it is still playing. */
  cancelReveal?: () => void;
}

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

/**
 * Whether `next` keeps every message of `previous` and adds some after them.
 * Message ids change only through writes that also change the structure
 * version, so the ends of the old list are enough to tell; checking every id
 * would cost a pass over the transcript on each appended message.
 */
function extendsList(
  next: readonly PineTranscriptMessage[],
  previous: readonly PineTranscriptMessage[],
): boolean {
  return (
    next.length > previous.length &&
    (previous.length === 0 ||
      (next[0]?.id === previous[0]?.id &&
        next[previous.length - 1]?.id === previous.at(-1)?.id))
  );
}

/** User messages in `next` that were not in `previous`. */
function newUserMessages(
  next: readonly PineTranscriptMessage[],
  previous: readonly PineTranscriptMessage[] | undefined,
): readonly PineTranscriptMessage[] {
  if (!previous) return next;
  // Most structure changes add an assistant or tool row and leave the list
  // of user messages as it was.
  if (next === previous) return [];
  if (extendsList(next, previous)) return next.slice(previous.length);
  const previousIds = new Set(previous.map((message) => message.id));
  return next.filter((message) => !previousIds.has(message.id));
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
    row?.querySelector<HTMLElement>('[data-slot="message-content"]') ?? row
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

/** Where a steering message leaves from: the composer it was typed in. */
function composerOrigin(container: HTMLElement | null): DOMRect | null {
  return (
    container
      ?.querySelector<HTMLElement>('[data-slot="session-composer"]')
      ?.getBoundingClientRect() ?? null
  );
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
  let x = from.left;
  let y = from.top;
  let frame: number | undefined;
  let startedAt: number | undefined;
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
    node.style.opacity = "0";
  }
  function release(): void {
    if (!held) return;
    held.style.opacity = heldOpacity;
    held.style.transform = heldTransform;
    held = null;
  }
  function place(): void {
    overlay.style.transform = `translate(${x}px, ${y}px)`;
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
      // Translate the complete message without resizing text or attachments.
      // Re-read the scrolling destination, using the same easing as the
      // viewport. Right alignment also survives a viewport-width change.
      const progressEased = easeOutExpo(progress);
      x = from.left + (rect.right - from.right) * progressEased;
      y = from.top + (rect.top - from.top) * progressEased;
      // Carry the real bubble along under the copy, so the hand-over is one
      // object travelling and changing style rather than a message that is
      // already parked while a ghost dissolves above it.
      node.style.transform = `translate(${x + from.width - rect.right}px, ${y - rect.top}px)`;
      if (progress === 1) {
        // Land exactly on the bubble, so removing the copy never strands the
        // message anywhere else.
        x = rect.right - from.width;
        y = rect.top;
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
  onFinish?: () => void,
): () => void {
  const origin = resolveOrigin();
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
    window.removeEventListener("wheel", cancel, true);
    window.removeEventListener("touchstart", cancel, true);
    onFinish?.();
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
    const rect = measure(initial);
    if (origin) {
      initial.style.transform = `translate(${origin.right - rect.width - rect.left}px, ${origin.top - rect.top}px)`;
    }
  }
  window.addEventListener("wheel", cancel, { capture: true, passive: true });
  window.addEventListener("touchstart", cancel, {
    capture: true,
    passive: true,
  });
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
  /**
   * Changes whenever the set or order of message ids changes, and only then.
   * A streaming update replaces a message in place and sends, edits or
   * appends nothing, so it does not need to wake this watcher at all.
   */
  structureVersion: Ref<unknown>;
  /**
   * The user messages of `messages`, in order, as the store keeps them: the
   * list is replaced only when a user message is added, removed or replaced.
   */
  userMessages: Ref<readonly PineTranscriptMessage[]>;
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
  /** The transcript and its structure as of the last pass. */
  let lastMessages: readonly PineTranscriptMessage[] | undefined;
  let lastUserMessages: readonly PineTranscriptMessage[] | undefined;
  let lastVersion: unknown;
  /** The generation of the last active pass. A queue first seen after a
   * reset (opening, switching or reactivating a session) is already there,
   * not sent, so its previews do not rise in. */
  let lastGeneration: number | undefined;
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
    [
      options.queue,
      options.structureVersion,
      options.active,
      options.sessionId,
    ],
    ([queue, version]) => {
      const messages = options.messages.value;
      const userMessages = options.userMessages.value;
      const oldMessages = lastMessages;
      const oldUserMessages = lastUserMessages;
      const structureChanged =
        oldMessages === undefined || version !== lastVersion;
      lastMessages = messages;
      lastUserMessages = userMessages;
      lastVersion = version;
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
        const source = sourceNodes?.[index];
        const rect = source?.getBoundingClientRect();
        if (source && isMeasurable(rect)) {
          const content = source.cloneNode(true) as HTMLElement;
          // The copy starts from where the preview is painted, and must not
          // carry any arrival styles along.
          content.style.removeProperty("opacity");
          content.style.removeProperty("transform");
          entry.snapshot = { rect, content };
        }
      });
      const unused = [...queued];
      const added: Entry[] = [];
      queued = queue.map((message) => {
        const index = unused.findIndex((entry) => entry.message === message);
        if (index >= 0) return unused.splice(index, 1)[0];
        const entry: Entry = { message };
        added.push(entry);
        return entry;
      });
      for (const entry of unused) entry.cancelReveal?.();
      // A message sent while the agent runs rises from the composer into the
      // staged previews, as a normally sent message rises into the transcript.
      // The whole row rises, so its actions travel with the bubble.
      if (lastGeneration === generation) {
        for (const entry of added) {
          const currentGeneration = generation;
          void nextTick(() => {
            if (generation !== currentGeneration) return;
            const resolveTarget = () => {
              const index = queued.indexOf(entry);
              return index < 0
                ? null
                : (options.container.value?.querySelectorAll<HTMLElement>(
                    '[data-slot="staged-steering-message"]',
                  )[index] ?? null);
            };
            const cancel = revealMessage(
              resolveTarget,
              () => composerOrigin(options.container.value),
              () => {
                cancellations.delete(cancel);
                if (entry.cancelReveal === cancel) delete entry.cancelReveal;
              },
            );
            entry.cancelReveal = cancel;
            cancellations.add(cancel);
          });
        }
      }
      lastGeneration = generation;
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
      // With the same ids in the same order nothing was sent, edited or
      // appended, so the checks below would find nothing.
      if (!structureChanged) return;
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
        oldMessages && extendsList(messages, oldMessages)
          ? messages.slice(oldMessages.length)
          : [];
      // One message appended to the end is a send. Hydrating a session can
      // also append into an empty list, so a batch is never an arrival.
      const arrived = appended.length === 1 ? appended : [];
      const flown = new Set<PineTranscriptMessage>();
      for (const message of newUserMessages(userMessages, oldUserMessages)) {
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
          const cancel = revealMessage(
            resolveTarget,
            () => transcriptOrigin(options.container.value),
            () => cancellations.delete(cancel),
          );
          cancellations.add(cancel);
        });
      }
    },
    { immediate: true, flush: "pre" },
  );
  onScopeDispose(reset);
}
