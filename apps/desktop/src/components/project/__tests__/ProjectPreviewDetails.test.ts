import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { ProjectFilePreview } from "@/shared/projectFiles";
import ProjectPreviewDetails from "../ProjectPreviewDetails.vue";
import type { PreviewRendererMetadata } from "../file-preview/previewRenderer";

const preview: ProjectFilePreview = {
  kind: "document",
  url: "pine-project-media://preview/document",
  size: 2048,
  modifiedAt: "2026-03-04T05:06:07.000Z",
  createdAt: "2025-01-02T03:04:05.000Z",
};

function render(
  props: Partial<{
    preview: ProjectFilePreview | undefined;
    loading: boolean;
    metadata: PreviewRendererMetadata;
  }> = {},
) {
  return mount(ProjectPreviewDetails, {
    props: {
      preview,
      loading: false,
      fileType: "PDF",
      path: "docs/report.pdf",
      metadata: undefined,
      ...props,
    },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

function rows(wrapper: ReturnType<typeof render>): [string, string][] {
  return wrapper
    .findAll("dt")
    .map((term) => [
      term.text(),
      term.element.nextElementSibling?.textContent?.trim() ?? "",
    ]);
}

describe("ProjectPreviewDetails", () => {
  it("lists what every file has, then what the preview measured", () => {
    const wrapper = render({ metadata: { pageCount: 12 } });
    const shown = Object.fromEntries(rows(wrapper));
    expect(Object.keys(shown)).toEqual([
      "Type",
      "Size",
      "Modified",
      "Created",
      "Location",
      "Pages",
    ]);
    expect(shown.Size).toBe("2 KB (2,048 B)");
    expect(shown.Modified).toContain("2026");
    expect(shown.Created).toContain("2025");
    expect(shown.Location).toBe("docs/report.pdf");
    expect(shown.Pages).toBe("12");
  });

  it("formats the format's own properties and leaves out empty ones", () => {
    const wrapper = render({
      metadata: {
        properties: [
          { key: "title", value: "Quarterly report" },
          { key: "author", value: "  " },
          { key: "words", type: "number", value: 12345 },
          {
            key: "documentCreated",
            type: "date",
            value: "2024-05-06T07:08:09.000Z",
          },
          { key: "encrypted", type: "boolean", value: false },
        ],
      },
    });
    const shown = rows(wrapper).slice(5);
    expect(shown.map(([label]) => label)).toEqual([
      "Title",
      "Words",
      "Document created",
      "Encrypted",
    ]);
    expect(shown[0]?.[1]).toBe("Quarterly report");
    expect(shown[1]?.[1]).toBe("12,345");
    expect(shown[2]?.[1]).toContain("2024");
    expect(shown[3]?.[1]).toBe("No");
  });

  it("holds the rows' place while the file is read", () => {
    const wrapper = render({ preview: undefined, loading: true });
    expect(wrapper.find("dl").exists()).toBe(false);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });
});
