import { expect, it } from "vitest";
import { isPineWindowResizeRequest } from "../window";

it("requires a usable width to set the workbench", () => {
  expect(
    isPineWindowResizeRequest({
      kind: "set-workbench",
      open: true,
      width: 480,
    }),
  ).toBe(true);
  expect(isPineWindowResizeRequest({ kind: "set-workbench", open: true })).toBe(
    false,
  );
  expect(
    isPineWindowResizeRequest({
      kind: "set-workbench",
      open: false,
      width: Number.NaN,
    }),
  ).toBe(false);
  expect(
    isPineWindowResizeRequest({ kind: "toggle-sidebar", open: true }),
  ).toBe(true);
  expect(isPineWindowResizeRequest({ kind: "toggle-sidebar" })).toBe(false);
});
