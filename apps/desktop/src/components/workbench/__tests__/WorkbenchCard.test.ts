import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  useArtifactVersionStore,
  workbenchVersionKey,
} from "@/stores/artifactVersions";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchCard from "../WorkbenchCard.vue";

vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({ activate: vi.fn() }),
}));

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

function mountCard() {
  return mount(WorkbenchCard, {
    props: { panel: "preview", position: "bottom" },
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: {
        WorkbenchPreviewPanel: true,
        WorkbenchCardPanelMenu: true,
        WorkbenchCardAddMenu: true,
      },
    },
  });
}

it("draws the highlight ring on an overlay above the previewer", () => {
  const store = useWorkbenchStore();
  store.isHighlighted = (panel) => panel === "preview";
  const card = mountCard().get("[data-testid=workbench-card]");
  const classes = card.classes();

  expect(card.attributes("data-highlighted")).toBe("true");
  // The card keeps previewers' z-indexes inside it...
  expect(classes).toContain("isolate");
  // ...and the ring is a pseudo-element stacked above them, not an outline
  // on the card that positioned previewer content paints over.
  expect(classes).toEqual(
    expect.arrayContaining([
      "before:absolute",
      "before:inset-0",
      "before:z-50",
      "before:pointer-events-none",
      "before:outline-1",
      "[--attention-flash-overlay-z-index:50]",
    ]),
  );
  expect(classes).not.toContain("outline-1");
});

it("shows no ring when the card is not highlighted", () => {
  const classes = mountCard().get("[data-testid=workbench-card]").classes();
  expect(classes).not.toContain("attention-flash");
  expect(classes.some((name) => name.startsWith("before:"))).toBe(false);
});

function submission(id: string, path: string) {
  return {
    createdAt: "2026-11-24T00:00:00.000Z",
    id: `m-${id}`,
    role: "assistant" as const,
    status: "complete" as const,
    blocks: [
      {
        type: "toolCall" as const,
        toolCall: {
          id,
          name: "ui_submit_artifact",
          input: { files: [{ path }] },
          output: { details: { files: [{ path }], rejected: [] } },
          status: "complete" as const,
        },
      },
    ],
  };
}

function version(toolCallId: string, current: boolean) {
  return {
    ref: { kind: "submission" as const, toolCallId },
    time: Date.UTC(2026, 10, 24),
    size: 2,
    state: "available" as const,
    current,
  };
}

it("gains the version history of a presented file once it is submitted, and lists each new version", async () => {
  const path = "/tmp/out/report.md";
  const artifactVersions = vi.fn((request: unknown) => {
    structuredClone(request);
    const submitted = session.messages.map(
      (message) =>
        message.blocks[0].type === "toolCall" && message.blocks[0].toolCall.id,
    );
    return Promise.resolve({
      path,
      versions: submitted
        .map((id, index) => version(String(id), index === submitted.length - 1))
        .reverse(),
      missing: false,
      modified: false,
      restorable: true,
    });
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onFilePreviewChanged: vi.fn(() => () => undefined),
      readPresentedFilePreview: vi.fn(() =>
        Promise.resolve({ kind: "unsupported", size: 2 }),
      ),
      setWatchedFilePreview: vi.fn(() => Promise.resolve()),
      artifactVersions,
    },
  });
  const session = useSessionStore();
  session.activeSession = {
    id: "s1",
    createdAt: "",
    updatedAt: "",
    messageCount: 1,
  };
  // The agent presents the file it is writing, before submitting it.
  useWorkbenchStore().preview({
    target: { source: "presented", path },
    toolCallId: "present-1",
    path,
  });
  const wrapper = mount(WorkbenchCard, {
    props: { panel: "preview", position: "bottom" },
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: { WorkbenchCardPanelMenu: true, WorkbenchCardAddMenu: true },
    },
  });
  await flushPromises();
  const menu = '[data-testid="artifact-version-menu"]';
  expect(wrapper.find(menu).exists()).toBe(false);

  session.messages = [submission("call-1", path)];
  await flushPromises();
  expect(wrapper.find(menu).exists()).toBe(true);

  // The menu read the history when it opened.
  const versions = useArtifactVersionStore();
  const key = workbenchVersionKey("s1");
  await versions.load(key);
  expect(versions.viewOf(key)?.history?.versions).toHaveLength(1);

  session.messages = [...session.messages, submission("call-2", path)];
  await flushPromises();
  expect(artifactVersions).toHaveBeenCalledTimes(2);
  expect(versions.viewOf(key)?.history?.versions).toEqual([
    version("call-2", true),
    version("call-1", false),
  ]);
  expect(wrapper.find(menu).exists()).toBe(true);
  wrapper.unmount();
});
