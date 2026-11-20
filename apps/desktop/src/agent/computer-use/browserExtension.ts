import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import pineIdentity from "@pine/computer-use-runtime/pine-identity.json";

export const PINE_BROWSER_EXTENSION_ID = pineIdentity.profile.extensionIds[0];
export const PINE_BROWSER_EXTENSION_NAME = pineIdentity.browserExtension.name;

/**
 * Keep a copy of the bundled extension at a path that survives Pine updates.
 * Chrome remembers an unpacked extension by its folder, and the bundled one
 * moves with the app: every Squirrel update on Windows installs into a new
 * `app-<version>` folder, and a macOS app can be moved or translocated. Only
 * files that differ are written, so an unchanged extension is left alone.
 * Returns false when the bundle has no extension to copy.
 */
export function syncBrowserExtension(source: string, target: string): boolean {
  if (!existsSync(path.join(source, "manifest.json"))) return false;
  syncDirectory(source, target);
  return true;
}

function syncDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  const wanted = new Set<string>();
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    wanted.add(entry.name);
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      syncDirectory(from, to);
      continue;
    }
    const data = readFileSync(from);
    const current = existsSync(to) ? readFileSync(to) : null;
    if (!current || !current.equals(data)) writeFileSync(to, data);
  }
  for (const name of readdirSync(target)) {
    if (!wanted.has(name)) {
      rmSync(path.join(target, name), { recursive: true, force: true });
    }
  }
}

/** Show the extension folder in the system file manager; best effort. */
export function revealInFileManager(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const [command, args] =
    platform === "darwin"
      ? ["open", ["-R", directory]]
      : platform === "win32"
        ? ["explorer.exe", [`/select,${directory}`]]
        : ["xdg-open", [path.dirname(directory)]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => {});
    child.unref();
  } catch {
    // The agent still has the path to give the user.
  }
}

function fileManagerName(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "Finder";
  if (platform === "win32") return "File Explorer";
  return "the file manager";
}

/** How to reach a hidden folder from the Load unpacked dialog. */
function folderPickerTip(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "The folder is under the hidden Library folder. In the Load unpacked dialog, press `⌘ + Shift + G`, paste the path and press Return, or drag the folder from the Finder window onto the dialog; then click Select.";
  }
  if (platform === "win32") {
    return "The folder is under the hidden AppData folder. In the Load unpacked dialog, paste the path into the address bar at the top and press Enter, then click Select Folder.";
  }
  return "The folder is under a hidden folder. In the Load unpacked dialog, press `Ctrl + L`, paste the path and press Enter, then confirm the folder.";
}

function supportedBrowsers(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "Google Chrome (stable, Beta or Canary) or Chromium";
  }
  if (platform === "win32") return "Google Chrome (stable or Beta) or Chromium";
  return "Google Chrome (stable, Beta or Dev) or Chromium";
}

export interface BrowserExtensionGuideOptions {
  extensionDirectory: string;
  /** False when this Pine build has no bundled extension to load. */
  available: boolean;
  platform?: NodeJS.Platform;
}

/**
 * The agent's reference for helping the user install Pine's browser
 * extension. It is returned with activation, so it varies only by platform and
 * install location and never enters the system prompt.
 */
export function browserExtensionGuide({
  extensionDirectory,
  available,
  platform = process.platform,
}: BrowserExtensionGuideOptions): string {
  const folder = `\`${extensionDirectory}\``;
  const missing = available
    ? ""
    : `\n\nThis Pine build has no browser extension at ${folder}, so browser tools cannot be set up. Tell the user the installation looks incomplete and that reinstalling Pine should restore it; do not try to build or fetch the extension yourself.`;
  return `# Pine browser extension

Browser tools (\`browser_*\`) reach the user's browser through the "${PINE_BROWSER_EXTENSION_NAME}" extension. It is not on the Chrome Web Store: the user loads it once as an unpacked extension, and a native-messaging host registered by Pine connects it to this app.${missing}

- Extension folder (load this exact folder; it contains \`manifest.json\`): ${folder}
- Extension ID once loaded: \`${PINE_BROWSER_EXTENSION_ID}\`
- Supported browsers: ${supportedBrowsers(platform)}, version 116 or later. Edge, Brave, Arc, Vivaldi and Opera can load the folder but cannot connect to Pine.
- The browser must have been opened at least once before registration, so its profile folder exists.

## You never install it yourself

Installing or repairing the extension is the user's job, and you guide it in words. Testing showed computer use is unreliable on these screens. Never open or drive \`chrome://extensions\`, Chrome settings, or the Load unpacked dialog with browser tools, desktop clicks, keyboard input, AppleScript, or the shell. Never edit browser profile files and never relaunch the browser with extension flags. If a runtime error says to reload the extension at \`chrome://extensions\`, that is an instruction for the user.

## Guiding the setup

1. Explain what it is and get the user's agreement first: the extension can read and control pages on every site and use the browser's debugger, but Pine only works in its own "${pineIdentity.browserExtension.groupTitle}" tab group, or in a tab the user hands over.
2. Call \`install_pine_browser_extension\` (it needs its own approval). It registers the native-messaging host and shows the extension folder in ${fileManagerName(platform)}. If the user has already loaded the extension and only the connection is missing, this step alone may fix it.
3. Give the user these steps, with the folder path in a code block they can copy:
   1. In the browser, open a new tab, type \`chrome://extensions\` in the address bar and press Enter.
   2. Turn on Developer mode with the switch in the top-right corner.
   3. Click Load unpacked and choose the extension folder. ${folderPickerTip(platform)}
   4. Check that a "${PINE_BROWSER_EXTENSION_NAME}" card appears with ID \`${PINE_BROWSER_EXTENSION_ID}\` and that its switch is on.
4. Ask the user to tell you when it is done, and wait. Then verify.

## Verifying

Call \`browser_list_tabs\`. A tab list (even an empty one) means the extension is connected. Chrome usually connects within a minute of loading or registration; if it still reports the extension is not connected, ask the user to click the reload icon on the "${PINE_BROWSER_EXTENSION_NAME}" card, or quit and reopen the browser, then check once more. Do not retry in a loop.

## When it does not work

- No Load unpacked button: Developer mode is off.
- "Manifest file is missing or unreadable": the wrong folder was chosen. It must be the folder above itself, the one that directly contains \`manifest.json\`, not its parent.
- The card shows a different ID or name: another copy was loaded. Ask the user to remove it and load the folder above.
- The extension is switched off or shows Errors, often after a Pine or browser update: ask the user to turn it on and click its reload icon.
- The user's browser is not one listed above: browser tools cannot connect there. Offer to work through desktop tools instead.
- \`install_pine_browser_extension\` reports no browser profile: ask the user to open the browser once, then call it again.
- Loading is blocked by the browser ("blocked by your administrator"): the browser is managed. The user must ask their administrator; there is no workaround.

## Without the extension

If the user declines or setup fails, say plainly which browser features are unavailable. You can still drive the browser window with desktop tools (\`get_app_state\` and \`click\` on the browser app), with the same care as any other app.`;
}

const EXTENSION_DISCONNECTED_PATTERN =
  /extension is not connected|extension, which is not connected|could not reach Chrome|native host is not connected/i;

/** A pointer back to the setup guide for errors caused by a missing extension. */
export function extensionDisconnectedHint(message: string): string | null {
  if (!EXTENSION_DISCONNECTED_PATTERN.test(message)) return null;
  return `The "${PINE_BROWSER_EXTENSION_NAME}" browser extension is not reachable. Follow the Pine browser extension guide returned when Computer Use was activated: guide the user through installing or reloading it in words, never by driving chrome://extensions yourself, then verify with browser_list_tabs.`;
}
