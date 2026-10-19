import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ screen: {} }));

import {
  easeOutExpo,
  interpolateBounds,
  projectWindowSize,
  projectWithSidebarSize,
  resizedBounds,
  deferWidthChange,
  sidebarBounds,
} from "../windowExpansion";

const workArea = { x: 0, y: 25, width: 1512, height: 920 };
const listBounds = { x: 196, y: 60, width: 1120, height: 840 };

describe("window layout sizing", () => {
  it("opens projects with the sidebar at the list size without shrinking wider windows", () => {
    expect(projectWithSidebarSize(listBounds)).toEqual({
      width: 1120,
      height: 840,
    });
    expect(
      projectWithSidebarSize({ ...listBounds, width: 1500, height: 900 }),
    ).toEqual({ width: 1500, height: 900 });
    expect(
      projectWithSidebarSize({ ...listBounds, width: 864, height: 840 }),
    ).toEqual({ width: 1120, height: 840 });
  });

  it("gives back the sidebar width only on a window's first closed fit", () => {
    expect(projectWindowSize(listBounds, false, true)).toEqual({
      width: 864,
      height: 840,
    });
    expect(projectWindowSize(listBounds, false, false)).toEqual({
      width: 1120,
      height: 840,
    });
    expect(
      projectWindowSize({ ...listBounds, width: 864 }, true, true),
    ).toEqual({ width: 1120, height: 840 });
  });

  it("restores the fixed project list size", () => {
    expect(
      resizedBounds({ x: 20, y: 30, width: 1400, height: 900 }, workArea, {
        width: 1120,
        height: 840,
      }),
    ).toEqual({ x: 160, y: 60, width: 1120, height: 840 });
  });

  it("stays inside the work area", () => {
    const size = { width: 1376, height: 840 };

    expect(
      resizedBounds({ ...listBounds, x: 380 }, workArea, size),
    ).toMatchObject({ x: 136, width: 1376 });
    expect(
      resizedBounds({ ...listBounds, x: 0 }, workArea, size),
    ).toMatchObject({ x: 0, width: 1376 });
    expect(
      resizedBounds(listBounds, { ...workArea, width: 1280 }, size),
    ).toMatchObject({ x: 0, width: 1280 });
  });

  it("skips windows that already have the target size", () => {
    expect(
      resizedBounds(listBounds, workArea, { width: 1120, height: 840 }),
    ).toBeNull();
  });

  it("adds and removes the sidebar width at the right edge", () => {
    const bounds = { x: 100, y: 60, width: 864, height: 840 };

    expect(sidebarBounds(bounds, workArea, 256, 720)).toEqual({
      ...bounds,
      width: 1120,
    });
    expect(
      sidebarBounds({ ...bounds, width: 1120 }, workArea, -256, 720),
    ).toEqual(bounds);
  });

  it("keeps sidebar resizing inside the work area and minimum width", () => {
    expect(
      sidebarBounds(
        { x: 500, y: 60, width: 864, height: 840 },
        workArea,
        256,
        720,
      ),
    ).toMatchObject({ x: 392, width: 1120 });
    expect(
      sidebarBounds(
        { x: 0, y: 60, width: 1400, height: 840 },
        workArea,
        256,
        720,
      ),
    ).toMatchObject({ x: 0, width: 1512 });
    expect(
      sidebarBounds(
        { x: 0, y: 60, width: 800, height: 840 },
        workArea,
        -256,
        720,
      ),
    ).toMatchObject({ x: 0, width: 720 });
    expect(
      sidebarBounds(
        { x: 0, y: 60, width: 720, height: 840 },
        workArea,
        -256,
        720,
      ),
    ).toBeNull();
  });

  it("accumulates sidebar toggles made while maximized or fullscreen", () => {
    expect(deferWidthChange(0, true)).toBe(256);
    expect(deferWidthChange(256, false)).toBe(0);
    expect(deferWidthChange(0, false)).toBe(-256);
    expect(deferWidthChange(256, true)).toBe(256);
    expect(deferWidthChange(-256, false)).toBe(-256);
  });

  it("eases out towards the target bounds", () => {
    const to = { x: 68, y: 60, width: 1376, height: 840 };

    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(interpolateBounds(listBounds, to, 0)).toEqual(listBounds);
    expect(interpolateBounds(listBounds, to, 1)).toEqual(to);
    expect(interpolateBounds(listBounds, to, 0.5).width).toBeGreaterThan(1350);
  });
});
