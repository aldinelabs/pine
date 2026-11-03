import type { PineCore } from "../pineCore";
import { registerAutomationRequests } from "./automations";
import { registerFileRequests } from "./files";
import { registerMcpRequests } from "./mcp";
import { registerModelRequests } from "./models";
import { registerProjectRequests } from "./projects";
import { registerSessionRequests } from "./sessions";
import { registerSettingsRequests } from "./settings";
import { registerSkillRequests } from "./skills";

/** Every request the desktop app and the browser interface share. */
export function registerCoreRequests(core: PineCore): void {
  registerSettingsRequests(core);
  registerModelRequests(core);
  registerProjectRequests(core);
  registerSessionRequests(core);
  registerFileRequests(core);
  registerSkillRequests(core);
  registerMcpRequests(core);
  registerAutomationRequests(core);
}
