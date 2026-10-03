import {
  BookOpenIcon,
  ClapperboardIcon,
  EyeIcon,
  HistoryIcon,
  MonitorCogIcon,
  PanelTopIcon,
  PlugIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "@lucide/vue";
import { describe, expect, it } from "vitest";
import {
  MEDIA_OPERATION_ICON,
  SKILL_OPERATION_ICON,
  TOOL_KIND_ICON,
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

  it("uses a dedicated kind for session history recall", () => {
    expect(toolKind("vcc_recall")).toBe("recall");
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
});
