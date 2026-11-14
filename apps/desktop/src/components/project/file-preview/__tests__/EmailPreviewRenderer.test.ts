import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import EmailPreviewRenderer from "../EmailPreviewRenderer.vue";
import type { PreviewRendererHandle } from "../previewRenderer";

const TEXT_MAIL = [
  "From: Ada <ada@example.com>",
  "To: Bob <bob@example.com>",
  "Subject: Plans",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "See you at noon.",
  "",
].join("\r\n");

const htmlMail = (subject: string, body: string) =>
  [
    "From: Ada <ada@example.com>",
    "To: Bob <bob@example.com>",
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    `<p>${body}</p>`,
    "",
  ].join("\n");

async function render(text: string, filePath: string, compact = false) {
  const wrapper = mount(EmailPreviewRenderer, {
    props: {
      preview: {
        kind: "text",
        text,
        encoding: "utf-8",
        size: text.length,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      fileName: filePath,
      filePath,
      active: true,
      mode: "rendered",
      zoom: 100,
      inverted: false,
      selectionLabel: "",
      compact,
    },
    global: { plugins: [createAppI18n("en-US")] },
  });
  // The parser loads on demand; wait until the message shows.
  await vi.waitFor(() => {
    if (wrapper.find('[role="status"]').exists()) throw new Error("loading");
  });
  await flushPromises();
  const handle = wrapper.vm as unknown as Required<PreviewRendererHandle>;
  return { wrapper, handle };
}

/** The test environment gives srcdoc frames no document of their own. */
async function loadFrame(
  wrapper: Awaited<ReturnType<typeof render>>["wrapper"],
  body: string,
) {
  const frame = wrapper.get("iframe");
  const page = document.implementation.createHTMLDocument("mail");
  page.body.innerHTML = body;
  Object.defineProperty(frame.element, "contentDocument", {
    value: page,
    configurable: true,
  });
  await frame.trigger("load");
  return page;
}

describe("EmailPreviewRenderer", () => {
  it("offers a plain message's headers and body for comments", async () => {
    const { wrapper, handle } = await render(TEXT_MAIL, "plans.eml");
    expect(wrapper.emitted("capabilitiesChange")).toContainEqual([
      { annotate: true },
    ]);
    const surfaces = handle.annotationSurfaces();
    expect(surfaces.map((surface) => surface.segment)).toEqual([
      "headers",
      undefined,
    ]);
    expect(surfaces[0]?.root.textContent).toContain("Plans");
    expect(surfaces[0]?.excluded).toBe("[data-mail-attachments]");
    expect(surfaces[1]?.root.textContent?.trim()).toBe("See you at noon.");
  });

  it("adds an HTML body once its frame loads, and says so", async () => {
    const { wrapper, handle } = await render(
      htmlMail("Plans", "Hello"),
      "plans.eml",
    );
    expect(handle.annotationSurfaces()).toHaveLength(1);
    const page = await loadFrame(wrapper, "<p>Hello</p>");
    expect(wrapper.emitted("annotationsChange")).toHaveLength(1);
    expect(handle.annotationSurfaces()[1]).toEqual({ root: page.body });
  });

  it("names each mailbox message and opens the one a comment is in", async () => {
    const mbox = [
      "From ada@example.com Mon Jan  1 00:00:00 2026",
      htmlMail("First", "One"),
      "From ada@example.com Tue Jan  2 00:00:00 2026",
      htmlMail("Second", "Two"),
    ].join("\n");
    const { wrapper, handle } = await render(mbox, "inbox.mbox");
    const page = await loadFrame(wrapper, "<p>One</p>");
    expect(handle.annotationSurfaces()).toEqual([
      expect.objectContaining({
        segment: "message:0:headers",
        place: { kind: "chapter", title: "First" },
      }),
      {
        root: page.body,
        segment: "message:0",
        place: { kind: "chapter", title: "First" },
      },
    ]);

    await handle.revealAnnotation({ segment: "message:1" });
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.text()).toContain("Second"));
    expect(wrapper.text()).toContain("Second");
    // The new message's frame has not loaded yet: only its headers show.
    expect(handle.annotationSurfaces()).toEqual([
      expect.objectContaining({
        segment: "message:1:headers",
        place: { kind: "chapter", title: "Second" },
      }),
    ]);

    await handle.revealAnnotation({ segment: "message:1:headers:raw" });
    await flushPromises();
    expect(
      handle.annotationSurfaces().map((surface) => surface.segment),
    ).toEqual(["message:1:headers", "message:1:headers:raw"]);
  });

  it("offers no comments in a compact card", async () => {
    const { wrapper } = await render(TEXT_MAIL, "plans.eml", true);
    expect(wrapper.emitted("capabilitiesChange")).not.toContainEqual([
      { annotate: true },
    ]);
  });
});
