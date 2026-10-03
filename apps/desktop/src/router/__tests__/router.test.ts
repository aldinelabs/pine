import { createPinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "..";
import { ROUTE_NAMES } from "../routes";

describe("workspace navigation", () => {
  it("opens the workspace directly", async () => {
    const router = createAppRouter(createPinia(), createMemoryHistory());

    await router.push("/");

    expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.workspace);
  });

  it.each(["/projects", "/projects/9ab0b15f-331f-4aa6-8056-cd2be3bf7414"])(
    "sends former project-list links (%s) to the workspace",
    async (path) => {
      const router = createAppRouter(createPinia(), createMemoryHistory());

      await router.push(path);

      expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.workspace);
    },
  );
});
