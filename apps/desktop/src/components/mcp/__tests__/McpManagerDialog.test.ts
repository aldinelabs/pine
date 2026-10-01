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
      "EmptyContent",
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
    const wrapper = mount(McpManagerDialog, {
      props: { open: true, projectId: "project-1" },
      global: {
        plugins: [createAppI18n("zh-CN")],
        stubs,
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("尚未配置服务器");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("添加服务器"))!
      .trigger("click");
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
      global: { plugins: [createAppI18n("zh-CN")], stubs },
    });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "编辑")!
      .trigger("click");

    expect(wrapper.text()).toContain("编辑 MCP 服务器");
    expect(wrapper.text()).not.toContain("mcp.editTitle");
  });
});
