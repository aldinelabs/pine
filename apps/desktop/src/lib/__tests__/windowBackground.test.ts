import { afterEach, describe, expect, it, vi } from "vitest";
import { syncWindowBackground } from "../windowBackground";

describe("syncWindowBackground", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--background");
    delete (window as { pine?: unknown }).pine;
  });

  it("reports the theme background to the window as hex", () => {
    const setWindowBackground = vi.fn(() => Promise.resolve());
    (window as { pine?: unknown }).pine = { setWindowBackground };
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      getImageData: () => ({ data: [12, 12, 9, 255] }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    document.documentElement.style.setProperty(
      "--background",
      "oklch(0.153 0.006 107.1)",
    );

    syncWindowBackground(document.documentElement);

    expect(context.fillStyle).toBe("oklch(0.153 0.006 107.1)");
    expect(setWindowBackground).toHaveBeenCalledWith("#0c0c09");
  });

  it("does nothing without the preload API", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

    syncWindowBackground(document.documentElement);

    expect(getContext).not.toHaveBeenCalled();
  });
});
