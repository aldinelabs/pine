import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAttentionFlashStore } from "../attentionFlash";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("attention flash registry", () => {
  it("flashes ids independently and stays idempotent", () => {
    const store = useAttentionFlashStore();
    store.flash("tab-1");
    store.flash("tab-2");
    store.flash("tab-2");
    expect(store.isFlashing("tab-1")).toBe(true);
    expect(store.isFlashing("tab-2")).toBe(true);
    expect(store.flashingIds.size).toBe(2);
  });

  it("ignores empty ids so an unkeyed surface cannot flash", () => {
    const store = useAttentionFlashStore();
    store.flash("");
    expect(store.flashingIds.size).toBe(0);
  });

  it("stops a single id, all ids, or ids that vanished", () => {
    const store = useAttentionFlashStore();
    store.flash("tab-1");
    store.flash("tab-2");
    store.stop("tab-1");
    expect(store.isFlashing("tab-1")).toBe(false);
    expect(store.isFlashing("tab-2")).toBe(true);

    store.retain(["tab-3"]);
    expect(store.isFlashing("tab-2")).toBe(false);

    store.flash("tab-4");
    store.stopAll();
    expect(store.flashingIds.size).toBe(0);
  });
});
