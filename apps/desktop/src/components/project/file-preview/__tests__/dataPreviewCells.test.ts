import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PreviewRendererHandle } from "../previewRenderer";
import DatasetPreviewRenderer from "../DatasetPreviewRenderer.vue";
import TablePreviewRenderer from "../TablePreviewRenderer.vue";

vi.mock("@tanstack/vue-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/vue-virtual")>();
  const { withAllRows } =
    await import("@/components/models/__tests__/helpers/virtualRows");
  return { ...actual, useVirtualizer: withAllRows(actual.useVirtualizer) };
});

vi.mock("../previewBytes", () => ({
  readPreviewBytes: () => Promise.resolve(new ArrayBuffer(0)),
  readPreviewText: () => Promise.resolve("name,value\nPine,42\nOak,7\n"),
}));

function datasetTable(name: string, prefix: string) {
  return {
    name,
    rowCount: 3,
    columns: [{ name: "id" }, { name: "label" }],
    rows: (start: number, end: number) =>
      Promise.resolve(
        Array.from({ length: end - start }, (_, offset) => [
          start + offset,
          `${prefix}${start + offset}`,
        ]),
      ),
  };
}

vi.mock("@/lib/datasets", () => ({
  openSqlite: () =>
    Promise.resolve({
      tables: [datasetTable("users", "u"), datasetTable("orders", "o")],
    }),
  openParquet: vi.fn(),
  openAvroDataset: vi.fn(),
  openWasm: vi.fn(),
}));

const props = {
  preview: { kind: "file" },
  fileName: "app.sqlite",
  filePath: "/p/app.sqlite",
  active: true,
  mode: "rendered",
  zoom: 100,
  inverted: false,
  selectionLabel: "Selected",
} as const;

function selectCells(
  wrapper: { element: Element },
  from: [number, number],
  to: [number, number],
) {
  const text = ([row, column]: [number, number]) =>
    wrapper.element.querySelector(
      `[data-row="${row}"] [data-column="${column}"]`,
    )!.firstChild!;
  document.getSelection()!.setBaseAndExtent(text(from), 0, text(to), 1);
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("cell comments in data previews", () => {
  it("offers a CSV's selected cells with their values", async () => {
    const wrapper = mount(TablePreviewRenderer, {
      props: { ...props, fileName: "t.csv", filePath: "/p/t.csv" } as never,
      global: { plugins: [createAppI18n("en-US")] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.emitted("capabilitiesChange")?.at(-1)).toEqual([
      { annotateCells: true },
    ]);
    selectCells(wrapper, [0, 0], [1, 1]);
    const handle = wrapper.vm as unknown as PreviewRendererHandle;
    expect(handle.annotationCellSelection?.()).toEqual({
      cells: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
      text: "Pine\t42\nOak\t7",
    });
    await wrapper.find('[data-slot="data-grid"]').trigger("scroll");
    expect(wrapper.emitted("annotationsChange")).toBeTruthy();
  });

  it("names the table of a dataset with several and switches to it", async () => {
    const wrapper = mount(DatasetPreviewRenderer, {
      props: props as never,
      global: { plugins: [createAppI18n("en-US")] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(wrapper.emitted("capabilitiesChange")?.at(-1)).toEqual([
      { annotateCells: true, toolbar: true },
    ]);
    const handle = wrapper.vm as unknown as PreviewRendererHandle;

    selectCells(wrapper, [1, 1], [1, 1]);
    expect(handle.annotationCellSelection?.()).toEqual({
      cells: {
        sheet: "users",
        startRow: 1,
        startColumn: 1,
        endRow: 1,
        endColumn: 1,
      },
      text: "u1",
    });

    const onOrders = {
      sheet: "orders",
      startRow: 2,
      startColumn: 0,
      endRow: 2,
      endColumn: 1,
    };
    // Cells on a table not shown have no box.
    expect(handle.annotationCellRects?.(onOrders)).toEqual([]);
    await handle.revealAnnotation?.({
      place: { kind: "sheet", name: "orders" },
      shape: { kind: "cells", cells: onOrders },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("o2");
    expect(wrapper.text()).not.toContain("u2");
  });
});
