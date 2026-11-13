import { afterEach, describe, expect, it } from "vitest";
import { isReadonly } from "vue";
import { useDocumentVisible } from "../useDocumentVisible";

function setDocumentVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  setDocumentVisibility("visible");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("useDocumentVisible", () => {
  it("follows the document's visibility", () => {
    const visible = useDocumentVisible();
    expect(visible.value).toBe(true);

    setDocumentVisibility("hidden");
    expect(visible.value).toBe(false);

    setDocumentVisibility("visible");
    expect(visible.value).toBe(true);
  });

  it("shares one read-only ref between callers", () => {
    const first = useDocumentVisible();
    const second = useDocumentVisible();

    setDocumentVisibility("hidden");

    expect(first.value).toBe(false);
    expect(second.value).toBe(false);
    expect(isReadonly(first)).toBe(true);
  });
});
