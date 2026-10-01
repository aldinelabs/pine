import { createPinia, setActivePinia } from "pinia";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { InputGroupInput } from "@/components/ui/input-group";
import type { PineProject } from "@/shared/projects";
import ProjectsView from "../ProjectsView.vue";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/project/ProjectDialog.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/window/WindowTitleBar.vue", () => ({
  default: {
    template:
      '<header><div data-slot="window-titlebar-leading"><slot name="leading" /></div><div data-slot="window-titlebar-trailing"><slot name="trailing" /></div></header>',
  },
}));

const project: PineProject = {
  createdAt: "2026-08-19T12:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "pine",
      path: "/projects/pine",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "pine",
  schemaVersion: 1,
  updatedAt: "2026-08-19T12:00:00.000Z",
};

async function mountView(
  projects: PineProject[],
  platform: "darwin" | "win32" = "darwin",
  openProject = vi.fn().mockResolvedValue({ opened: true, project }),
  setWindowLayout = vi.fn().mockResolvedValue(undefined),
) {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      listProjects: vi.fn().mockResolvedValue({ projects }),
      openProject,
      platform,
      setWindowLayout,
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = shallowMount(ProjectsView, {
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: {
        InputGroup: false,
        Item: false,
        ItemContent: false,
        ItemDescription: false,
        ItemGroup: false,
        ItemMedia: false,
        ItemTitle: false,
        Primitive: {
          props: ["as"],
          template: '<component :is="as"><slot /></component>',
        },
        WindowTitleBar: false,
      },
    },
  });

  await flushPromises();
  return wrapper;
}

describe("ProjectsView", () => {
  it("locks the window to the fixed project list layout", async () => {
    const setWindowLayout = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountView([], "darwin", undefined, setWindowLayout);

    expect(setWindowLayout).toHaveBeenCalledExactlyOnceWith("projects");
    wrapper.unmount();
  });

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders the project row as the open action without a separate button", async () => {
    const wrapper = await mountView([project]);
    const projectCard = wrapper.get('[data-testid="project-card"]');
    expect(projectCard.element.tagName).toBe("BUTTON");
    expect(projectCard.text()).toContain("/projects/pine");
    expect(projectCard.text()).not.toContain("打开");
  });

  it("hides the create item while searching by project name", async () => {
    const wrapper = await mountView([project]);

    expect(wrapper.findAll('[data-testid="project-card"]')).toHaveLength(1);

    wrapper.getComponent(InputGroupInput).vm.$emit("update:modelValue", "pine");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="create-project-card"]').exists()).toBe(
      false,
    );
    expect(wrapper.findAll('[data-testid="project-card"]')).toHaveLength(1);

    wrapper
      .getComponent(InputGroupInput)
      .vm.$emit("update:modelValue", "missing");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="project-card"]')).toHaveLength(0);
  });

  it("places the project search beside the logo on Windows", async () => {
    const wrapper = await mountView([], "win32");
    const leading = wrapper.get('[data-slot="window-titlebar-leading"]');
    const trailing = wrapper.get('[data-slot="window-titlebar-trailing"]');

    expect(leading.find('[data-testid="windows-titlebar-logo"]').exists()).toBe(
      true,
    );
    expect(leading.find('[data-testid="project-search"]').exists()).toBe(true);
    expect(trailing.find('[data-testid="project-search"]').exists()).toBe(
      false,
    );
  });

  it("disables the project library while a project is opening", async () => {
    let resolveOpening!: (result: {
      opened: true;
      project: PineProject;
    }) => void;
    const openProject = vi.fn().mockReturnValue(
      new Promise<{ opened: true; project: PineProject }>((resolve) => {
        resolveOpening = resolve;
      }),
    );
    const wrapper = await mountView([project], "darwin", openProject);

    await wrapper.get('[data-testid="project-card"]').trigger("click");

    expect(openProject).toHaveBeenCalledWith({ id: project.id });
    expect(wrapper.attributes("inert")).toBeDefined();
    expect(
      wrapper.get('[data-testid="create-project-card"]').element,
    ).toHaveProperty("disabled", true);
    expect(wrapper.get('[data-testid="project-card"]').element).toHaveProperty(
      "disabled",
      true,
    );

    resolveOpening({ opened: true, project });
    await flushPromises();

    expect(wrapper.attributes("inert")).toBeUndefined();
  });
});
