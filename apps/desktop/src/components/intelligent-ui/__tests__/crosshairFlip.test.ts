import { afterEach, describe, expect, it, vi } from "vitest";
import { observeCrosshairFlip } from "../crosshairFlip";

const SVG = "http://www.w3.org/2000/svg";

function crosshair() {
  const root = document.createElement("div");
  const svg = document.createElementNS(SVG, "svg");
  const group = document.createElementNS(SVG, "g");
  group.setAttribute("class", "css-1abc-crosshair-component");
  const line = document.createElementNS(SVG, "line");
  const dot = document.createElementNS(SVG, "circle");
  group.append(line, dot);
  svg.append(group);
  root.append(svg);
  document.body.append(root);
  const animate = vi.fn<Element["animate"]>(
    () => ({ cancel: vi.fn() }) as unknown as Animation,
  );
  line.animate = animate;
  dot.animate = animate;
  return { root, group, line, dot, animate };
}

/** Mutation records arrive in a microtask. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("observeCrosshairFlip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("slides the line and dots from where they jumped from", async () => {
    const { root, group, line, dot, animate } = crosshair();
    group.setAttribute("style", "opacity: 1");
    line.setAttribute("x1", "100");
    dot.setAttribute("cx", "100");
    dot.setAttribute("cy", "40");
    const stop = observeCrosshairFlip(root);

    group.setAttribute("style", "opacity: 1");
    line.setAttribute("x1", "160");
    dot.setAttribute("cx", "160");
    dot.setAttribute("cy", "10");
    await flush();

    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: "translate(-60px, 0px)" },
      { transform: "translate(0, 0)" },
    ]);
    expect(animate.mock.calls[1][0]).toEqual([
      { transform: "translate(-60px, 30px)" },
      { transform: "translate(0, 0)" },
    ]);
    stop();
  });

  it("leaves a crosshair that stays on its point alone", async () => {
    const { root, line, animate } = crosshair();
    line.setAttribute("x1", "100");
    const stop = observeCrosshairFlip(root);

    // Unovis writes the same position again on every pointer move.
    line.setAttribute("x1", "100");
    line.setAttribute("x1", "100");
    await flush();

    expect(animate).not.toHaveBeenCalled();
    stop();
  });

  it("shows a reappearing crosshair at its new point without a slide", async () => {
    const { root, group, line, animate } = crosshair();
    group.setAttribute("style", "opacity: 0");
    line.setAttribute("x1", "100");
    const stop = observeCrosshairFlip(root);

    group.setAttribute("style", "opacity: 1");
    line.setAttribute("x1", "300");
    await flush();

    expect(animate).not.toHaveBeenCalled();
    stop();
  });
});
