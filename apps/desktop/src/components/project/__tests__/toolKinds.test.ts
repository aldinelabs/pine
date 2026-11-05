import {
  AppWindowIcon,
  BookOpenIcon,
  CalendarClockIcon,
  ClapperboardIcon,
  ClockIcon,
  CpuIcon,
  ServerCogIcon,
  EyeIcon,
  FileSearchIcon,
  HistoryIcon,
  MonitorCogIcon,
  PanelTopIcon,
  PlugIcon,
  PlusIcon,
  SquarePenIcon,
  TextSearchIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "@lucide/vue";
import { describe, expect, it } from "vitest";
import {
  MEDIA_OPERATION_ICON,
  SKILL_OPERATION_ICON,
  TOOL_KIND_ICON,
  automationOperation,
  fileSearchOperation,
  mcpConfigOperation,
  toolIconForName,
  toolKind,
} from "../toolKinds";

describe("Computer Use tool kinds", () => {
  it("uses dedicated desktop and browser kinds", () => {
    expect(toolKind("activate_computer_use")).toBe("computer");
    expect(toolKind("get_app_state")).toBe("computer");
    expect(toolKind("browser_snapshot")).toBe("browser");
    expect(TOOL_KIND_ICON.computer).toBe(MonitorCogIcon);
    expect(TOOL_KIND_ICON.browser).toBe(PanelTopIcon);
  });

  it("uses a dedicated kind for presented files", () => {
    expect(toolKind("ui_present_file")).toBe("presentFile");
    expect(TOOL_KIND_ICON.presentFile).toBe(EyeIcon);
  });

  it("keeps file search apart from web search", () => {
    expect(toolKind("find")).toBe("fileSearch");
    expect(toolKind("grep")).toBe("fileSearch");
    expect(toolKind("web_search")).toBe("search");
    expect(TOOL_KIND_ICON.fileSearch).toBe(FileSearchIcon);
    expect(toolIconForName("grep")).toBe(TextSearchIcon);
    expect(toolIconForName("find")).toBe(FileSearchIcon);
    expect(fileSearchOperation("grep")).toBe("grep");
    expect(fileSearchOperation("find")).toBe("find");
  });

  it("uses a dedicated kind for session history recall", () => {
    expect(toolKind("recall")).toBe("recall");
    expect(TOOL_KIND_ICON.recall).toBe(HistoryIcon);
  });

  it("recognizes adapter proxy, script, and namespaced MCP tools", () => {
    expect(toolKind("mcp")).toBe("mcp");
    expect(toolKind("mcpScript")).toBe("mcp");
    expect(toolKind("mcp__github")).toBe("mcp");
    expect(toolKind("mcp__github_search_repositories")).toBe("mcp");
    expect(TOOL_KIND_ICON.mcp).toBe(PlugIcon);
  });

  it("uses dedicated kinds and icons for Skill operations", () => {
    expect(toolKind("activate_skill_authoring")).toBe("skill");
    expect(toolKind("invoke_skill")).toBe("skill");
    expect(toolKind("create_skill")).toBe("skill");
    expect(toolKind("edit_skill")).toBe("skill");
    expect(toolKind("remove_skill")).toBe("skill");
    expect(TOOL_KIND_ICON.skill).toBe(WandSparklesIcon);
    expect(SKILL_OPERATION_ICON.activateAuthoring).toBe(WandSparklesIcon);
    expect(SKILL_OPERATION_ICON.invoke).toBe(BookOpenIcon);
    expect(SKILL_OPERATION_ICON.create).toBe(PlusIcon);
    expect(SKILL_OPERATION_ICON.edit).toBe(SquarePenIcon);
    expect(SKILL_OPERATION_ICON.remove).toBe(Trash2Icon);
    expect(toolIconForName("invoke_skill")).toBe(BookOpenIcon);
  });

  it("uses a dedicated kind and icons for media generation", () => {
    expect(toolKind("activate_media_generation")).toBe("media");
    expect(toolKind("generate_image")).toBe("media");
    expect(TOOL_KIND_ICON.media).toBe(ClapperboardIcon);
    expect(MEDIA_OPERATION_ICON.activateMediaGeneration).toBe(ClapperboardIcon);
    expect(MEDIA_OPERATION_ICON.generateImage).toBe(WandSparklesIcon);
    expect(toolIconForName("generate_image")).toBe(WandSparklesIcon);
  });

  it("uses an app window icon for activating Pine operations", () => {
    expect(toolIconForName("activate_pine_ops")).toBe(AppWindowIcon);
  });

  it("uses dedicated kinds for automation and model tools", () => {
    expect(toolKind("activate_automation_authoring")).toBe("automation");
    expect(toolKind("automation_save")).toBe("automation");
    expect(toolKind("automation_report")).toBe("automation");
    expect(toolKind("ui_list_models")).toBe("model");
    expect(toolIconForName("automation_list")).toBe(CalendarClockIcon);
    expect(toolIconForName("ui_list_models")).toBe(CpuIcon);
  });

  it("gives the datetime tool its own kind and clock icon", () => {
    expect(toolKind("datetime")).toBe("datetime");
    expect(toolIconForName("datetime")).toBe(ClockIcon);
  });

  it("gives MCP configuration tools their own kind, apart from MCP calls", () => {
    expect(toolKind("activate_mcp_authoring")).toBe("mcpConfig");
    expect(toolKind("mcp_config_save")).toBe("mcpConfig");
    expect(toolKind("mcp")).toBe("mcp");
    expect(toolKind("mcp__github__list_issues")).toBe("mcp");
    expect(toolIconForName("mcp_config_list")).toBe(ServerCogIcon);
  });

  it("tells MCP configuration operations apart", () => {
    expect(mcpConfigOperation("mcp_config_save", {})).toBe("create");
    expect(
      mcpConfigOperation(
        "mcp_config_save",
        {},
        { details: { created: false } },
      ),
    ).toBe("update");
    expect(mcpConfigOperation("mcp_config_save", { previousName: "old" })).toBe(
      "update",
    );
    expect(
      mcpConfigOperation("mcp_config_set_enabled", { enabled: false }),
    ).toBe("disable");
    expect(
      mcpConfigOperation("mcp_config_set_enabled", { enabled: true }),
    ).toBe("enable");
    expect(mcpConfigOperation("mcp_config_remove", {})).toBe("remove");
    expect(mcpConfigOperation("mcp_config_list", {})).toBe("list");
    expect(mcpConfigOperation("activate_mcp_authoring", {})).toBe("activate");
  });

  it("tells automation operations apart by their arguments", () => {
    expect(automationOperation("automation_save", {})).toBe("create");
    expect(automationOperation("automation_save", { id: "a" })).toBe("update");
    expect(
      automationOperation("automation_set_enabled", { enabled: false }),
    ).toBe("pause");
    expect(
      automationOperation("automation_set_enabled", { enabled: true }),
    ).toBe("resume");
    expect(automationOperation("automation_run_now", {})).toBe("runNow");
  });
});
