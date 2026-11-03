/**
 * Stable IDs for the Pine tools an automation may use. Definitions store the
 * ID, so renaming a tool only changes `names` here. Never reuse or delete an
 * entry: a removed tool stays as a tombstone so runs that need it fail with a
 * clear reason instead of silently losing a capability.
 */
export interface AutomationToolEntry {
  id: string;
  /** Current names; the first one that exists on the platform is used. */
  names: string[];
  /** Runs outside the sandbox after the approval model reviews it. */
  privileged?: true;
  /** Reaches the network outside the run's own allowlist. */
  network?: true;
  removed?: true;
}

export const AUTOMATION_TOOLS: readonly AutomationToolEntry[] = [
  { id: "b9c87caa-1935-4cf8-bdbc-33fa126a3d6d", names: ["read"] },
  { id: "06b14610-2de5-4b32-81d5-2c2e97972d23", names: ["edit"] },
  { id: "6608ef2e-074a-48f4-b370-49c48c086432", names: ["write"] },
  // One capability on every platform: bash, or PowerShell on Windows.
  {
    id: "45382db3-ab11-4769-ace6-873f7cd3bf32",
    names: ["bash", "powershell"],
  },
  {
    id: "243a6d81-0d90-4e86-bbd7-91a6e25c2ea1",
    names: ["privileged_bash", "privileged_powershell"],
    privileged: true,
  },
  { id: "3ba5146d-83c2-4073-8a83-1b0fb9365160", names: ["todo"] },
  { id: "8d63a8e2-42e6-4d9e-9f5a-5c6c6aec10cc", names: ["invoke_skill"] },
  {
    id: "6c86a057-0bf6-4812-8370-3252fd1e36e6",
    names: ["list_skill_resources"],
  },
  {
    id: "8b00cefa-4750-468d-8b4d-25e92fae2852",
    names: ["read_skill_resource"],
  },
  {
    id: "0d4dd667-2dce-4bf4-9e62-2b632f14362a",
    names: ["web_search"],
    network: true,
  },
  {
    id: "baff4daa-8600-477a-96ab-4f6fc9405154",
    names: ["web_fetch"],
    network: true,
  },
  {
    id: "d26a3f01-d1c8-4522-9516-0dce9fe278b8",
    names: ["generate_image"],
    network: true,
  },
  { id: "d0c50d27-609a-4842-9957-5ae6da4b032c", names: ["bg_run"] },
  { id: "3e2050bd-c971-4728-b62d-0593aa9f046d", names: ["bg_status"] },
  { id: "62150a1d-66c6-46e3-b3b0-05888e41a21e", names: ["bg_logs"] },
  { id: "cdb3cac1-229a-423d-870a-d805cd55ed75", names: ["bg_kill"] },
  { id: "f49bf58e-2252-43dd-a6a9-b76110bfe562", names: ["recall"] },
];

/** File tools every new definition starts with. */
export const DEFAULT_AUTOMATION_TOOL_NAMES = ["read", "edit", "write"];

export function automationToolByName(
  name: string,
): AutomationToolEntry | undefined {
  return AUTOMATION_TOOLS.find(
    (entry) => !entry.removed && entry.names.includes(name),
  );
}

export function automationToolById(
  id: string,
): AutomationToolEntry | undefined {
  return AUTOMATION_TOOLS.find((entry) => entry.id === id);
}

/** The name the agent knows this tool by on this platform. */
export function automationToolName(
  entry: AutomationToolEntry,
  platform: NodeJS.Platform = process.platform,
): string {
  if (entry.names.length > 1)
    return platform === "win32"
      ? (entry.names[1] ?? entry.names[0])
      : entry.names[0];
  return entry.names[0];
}
