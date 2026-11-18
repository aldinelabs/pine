import { describe, expect, it } from "vitest";
import { chartAxes, chartSeriesKeys } from "../intelligentUiChart";

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

describe("chartAxes", () => {
  const rows = [
    { month: "Jan", sales: 3, costs: 2 },
    { month: "Feb", sales: 5, costs: 4 },
  ];

  it("keeps an x and series the block gives", () => {
    expect(chartAxes(rows, "bar", "month", ["sales"])).toEqual({
      x: "month",
      series: ["sales"],
    });
  });

  it("infers the category key and every numeric series", () => {
    expect(chartAxes(rows, "line", undefined, undefined)).toEqual({
      x: "month",
      series: ["sales", "costs"],
    });
  });

  it("plots the first number key on x for scatter", () => {
    expect(
      chartAxes([{ height: 170, weight: 65 }], "scatter", undefined, []),
    ).toEqual({ x: "height", series: ["weight"] });
  });
});
