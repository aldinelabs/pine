import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectRightSidebarTools from "../ProjectRightSidebarTools.vue";
import { showProject } from "@/stores/__tests__/showProject";

function dialogStub(name: string) {
  return {
    props: ["open", "projectId"],
    emits: ["update:open"],
    template: `<div data-${name} :data-open="open" :data-project-id="projectId" />`,
  };
}

it("lists work skills above MCP servers and opens each manager", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  showProject({
    id: "one",
    name: "One",
    createdAt: "",
    updatedAt: "",
    schemaVersion: 1,
    defaultFolderId: "folder",
    folders: [],
  });
  const slot = { template: "<div><slot /></div>" };
  const wrapper = mount(ProjectRightSidebarTools, {
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: {
        SidebarMenu: slot,
        SidebarMenuButton: slot,
        SidebarMenuItem: slot,
        SkillManagerDialog: dialogStub("skill-manager"),
        McpManagerDialog: dialogStub("mcp-manager"),
      },
    },
  });
  const text = wrapper.text();
  expect(text.indexOf("工作技能")).toBeLessThan(text.indexOf("MCP"));

  await wrapper.get("[data-testid='project-skills-button']").trigger("click");
  expect(wrapper.get("[data-skill-manager]").attributes("data-open")).toBe(
    "true",
  );
  expect(
    wrapper.get("[data-skill-manager]").attributes("data-project-id"),
  ).toBe("one");
  await wrapper.get("[data-testid='project-mcp-button']").trigger("click");
  expect(wrapper.get("[data-mcp-manager]").attributes("data-open")).toBe(
    "true",
  );
});
