import { createPinia, setActivePinia } from "pinia";
import { useHelpStore } from "@/stores/help";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import McpManagerDialog from "../McpManagerDialog.vue";

const passthrough = { template: "<div><slot /></div>" };
const dialog = {
  props: ["open"],
  template: '<div v-if="open" data-dialog><slot /></div>',
};
const stubs = {
  Dialog: dialog,
  ...Object.fromEntries(
    [
      "AlertDialog",
      "AlertDialogAction",
      "AlertDialogCancel",
      "AlertDialogContent",
      "AlertDialogDescription",
      "AlertDialogFooter",
      "AlertDialogHeader",
      "AlertDialogTitle",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogTitle",
      "Empty",
      "EmptyDescription",
      "EmptyHeader",
      "EmptyTitle",
      "Field",
      "FieldDescription",
      "FieldError",
      "FieldGroup",
      "FieldLabel",
      "Item",
      "ItemActions",
      "ItemContent",
      "ItemDescription",
      "ItemGroup",
      "ItemTitle",
      "ScrollArea",
      "Switch",
      "Tabs",
      "TabsContent",
      "TabsList",
      "TabsTrigger",
    ].map((name) => [name, passthrough]),
  ),
};

describe("McpManagerDialog", () => {
  it("keeps the server list open while the editor opens as a second dialog", async () => {
    window.pine = {
      listMcpServers: vi.fn().mockResolvedValue({
        paths: {
          project: "/project/.mcp.json",
          global: "/home/.config/mcp/mcp.json",
        },
        servers: [],
      }),
    } as unknown as Window["pine"];
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(McpManagerDialog, {
      props: { open: true, projectId: "project-1" },
      global: {
        plugins: [pinia, createAppI18n("zh-CN")],
        stubs,
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("尚未配置服务器");
    // The guide button sits by the title and opens the MCP guide without
    // closing the manager.
    const guide = wrapper.get('[data-slot="help-guide-badge"]');
    expect(guide.text()).toBe("MCP 服务器怎么用");
    await guide.trigger("click");
    expect(useHelpStore().topicId).toBe("mcp");
    expect(wrapper.emitted("update:open")).toBeUndefined();
    const addButtons = wrapper
      .findAll("button")
      .filter((button) => button.text().includes("添加服务器"));
    // The empty state leaves adding to the footer instead of repeating it.
    expect(addButtons).toHaveLength(1);
    expect(
      wrapper
        .findAll("button")
        .filter((button) => button.text().includes("和 Pine 协作管理")),
    ).toHaveLength(1);
    await addButtons[0].trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("尚未配置服务器");
    expect(wrapper.text()).toContain("服务器配置（JSON）");
    expect(wrapper.findAll("[data-dialog]")).toHaveLength(2);
  });

  it("shows the translated edit title and separates delete from save", async () => {
    window.pine = {
      listMcpServers: vi.fn().mockResolvedValue({
        paths: { project: "/project/.mcp.json", global: "/global/mcp.json" },
        servers: [
          {
            name: "canvas-api",
            scope: "project",
            definition: { command: "canvas-mcp-server" },
          },
        ],
      }),
    } as unknown as Window["pine"];
    const wrapper = mount(McpManagerDialog, {
      props: { open: true, projectId: "project-1" },
      global: { plugins: [createPinia(), createAppI18n("zh-CN")], stubs },
    });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "编辑")!
      .trigger("click");

    expect(wrapper.text()).toContain("编辑 MCP 服务器");
    expect(wrapper.text()).not.toContain("mcp.editTitle");
  });

  it("hands MCP setup to a conversation with Pine and closes", async () => {
    window.pine = {
      listMcpServers: vi.fn().mockResolvedValue({
        paths: { project: "/p/.mcp.json", global: "/g/mcp.json" },
        servers: [],
      }),
    } as unknown as Window["pine"];
    const wrapper = mount(McpManagerDialog, {
      props: { open: true, projectId: "project-1" },
      global: { plugins: [createPinia(), createAppI18n("zh-CN")], stubs },
    });
    await flushPromises();
    await wrapper.get('[data-testid="mcp-create-with-pine"]').trigger("click");
    expect(wrapper.emitted("createWithPine")).toEqual([["project-1"]]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });
});
