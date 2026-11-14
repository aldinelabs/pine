import { describe, expect, it } from "vitest";
import { chartSeriesKeys } from "../intelligentUiChart";

describe("chartSeriesKeys", () => {
  const rows = [
    { species: "人", total: 86, cortex: 16.3 },
    { species: "猕猴", total: 6.4, cortex: 1.7 },
  ];

  it("reads series that are keys of the data as they are", () => {
    expect(chartSeriesKeys(rows, "species", ["cortex"])).toEqual(["cortex"]);
  });

  it("maps display names to the rows' numeric keys in order", () => {
    expect(chartSeriesKeys(rows, "species", ["全脑", "皮层"])).toEqual([
      "total",
      "cortex",
    ]);
  });

  it("leaves series alone when the numeric keys do not line up", () => {
    expect(chartSeriesKeys(rows, "species", ["全脑"])).toEqual(["全脑"]);
    expect(chartSeriesKeys([], "species", ["全脑"])).toEqual(["全脑"]);
  });
});
