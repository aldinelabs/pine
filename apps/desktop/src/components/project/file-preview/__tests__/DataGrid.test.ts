import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import DataGrid from "../DataGrid.vue";

vi.mock("@tanstack/vue-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/vue-virtual")>();
  const { withAllRows } =
    await import("@/components/models/__tests__/helpers/virtualRows");
  return { ...actual, useVirtualizer: withAllRows(actual.useVirtualizer) };
});

const columns = [
  { key: "id", label: "id", type: "INTEGER" },
  { key: "name", label: "name" },
];

function render(rowCount: number, loadRows = vi.fn()) {
  return mount(DataGrid, {
    props: { columns, rowCount, loadRows },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

describe("DataGrid", () => {
  it("loads rows in pages and formats their cells", async () => {
    const loadRows = vi.fn((start: number, end: number) =>
      Promise.resolve(
        Array.from({ length: end - start }, (_, offset) => [
          start + offset,
          offset === 1 ? null : `row ${start + offset}`,
        ]),
      ),
    );
    const wrapper = render(450, loadRows);
    await flushPromises();
    // Every row is on screen here, so all three pages load once each.
    expect(loadRows.mock.calls).toEqual([
      [0, 200],
      [200, 400],
      [400, 450],
    ]);
    const headers = wrapper.findAll('[role="columnheader"]');
    expect(headers[1]?.text()).toContain("INTEGER");
    const first = wrapper.findAll('[role="row"]')[1];
    expect(first.text()).toContain("row 0");
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[3]?.text()).toBe("NULL");
    expect(cells[0]?.classes()).toContain("text-right");
  });

  it("reports a failed page", async () => {
    const wrapper = render(
      3,
      vi.fn(() => Promise.reject(new Error("broken"))),
    );
    await flushPromises();
    expect(wrapper.emitted("failed")).toHaveLength(1);
  });
});
