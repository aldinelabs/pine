import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { expect, it } from "vitest";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskInspector from "../ProjectBackgroundTaskInspector.vue";

it("opens one dialog for the inspected process and clears it on close", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useBackgroundTasksStore();
  const wrapper = mount(ProjectBackgroundTaskInspector, {
    global: {
      plugins: [pinia],
      stubs: { ProjectBackgroundTaskDialog: true },
    },
  });
  const dialog = () =>
    wrapper.findComponent({ name: "ProjectBackgroundTaskDialog" });

  expect(dialog().props("open")).toBe(false);
  store.inspect("b1234abcd");
  await nextTick();
  expect(dialog().props()).toMatchObject({ open: true, taskId: "b1234abcd" });

  dialog().vm.$emit("update:open", false);
  expect(store.inspectedTaskId).toBeNull();
  wrapper.unmount();
});
