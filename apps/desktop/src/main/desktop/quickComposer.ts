import path from "node:path";
import { z } from "zod";
import {
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  systemPreferences,
} from "electron";
import { writeQuickComposerEnabled } from "../../agent/pineSettings";
import {
  PROJECT_ATTACHMENTS_DIRECTORY,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  isTemporaryWorkspace,
} from "../../shared/projects";
import {
  DEFAULT_QUICK_COMPOSER_ENABLED,
  DELIVER_QUICK_COMPOSER_CHANNEL,
  GET_QUICK_COMPOSER_CHANNEL,
  HIDE_QUICK_COMPOSER_CHANNEL,
  PRESENT_QUICK_COMPOSER_HANDOFF_CHANNEL,
  QUICK_COMPOSER_ACCELERATOR,
  REQUEST_QUICK_COMPOSER_PERMISSION_CHANNEL,
  SET_QUICK_COMPOSER_CHANNEL,
  SET_QUICK_COMPOSER_GLASS_CHANNEL,
  SET_QUICK_COMPOSER_PASS_THROUGH_CHANNEL,
  SUBMIT_QUICK_COMPOSER_CHANNEL,
  TAKE_QUICK_COMPOSER_HANDOFF_CHANNEL,
  type QuickComposerHandoff,
  type SetQuickComposerResult,
} from "../../shared/quickComposer";
import {
  captureAppContext,
  discardAppContext,
  frontmostApp,
} from "../appContext";
import type { PineCore } from "../core/pineCore";
import { QuickComposerController } from "../quickComposer";
import {
  setGlassCornerRadius,
  setWindowAnimates,
  windowCornerRadius,
} from "../sidebarGlass";
import type { DesktopWindows } from "./windows";

const QuickComposerRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

const SubmitQuickComposerSchema = z.object({
  message: z.string().min(1),
  approvalMode: z.enum(["let-me-review", "auto-approve", "autonomous", "YOLO"]),
  projectId: z.string().min(1),
  withContext: z.boolean(),
  composerRect: QuickComposerRectSchema,
});

interface DesktopQuickComposerOptions {
  core: () => PineCore | null;
  windows: DesktopWindows;
  windowForClient(clientId: number): BrowserWindow | undefined;
  focus(window: BrowserWindow): void;
}

/** The floating composer behind its global shortcut, and its IPC. */
export class DesktopQuickComposer {
  readonly controller: QuickComposerController;
  private enabled = DEFAULT_QUICK_COMPOSER_ENABLED;

  constructor(private readonly options: DesktopQuickComposerOptions) {
    const { windows } = options;
    this.controller = new QuickComposerController({
      createPanel: (bounds) => windows.createQuickComposerPanel(bounds),
      createGlass: () => windows.createQuickComposerGlass(),
      setGlassRadius: (glass, radius) => setGlassCornerRadius(glass, radius),
      windowCornerRadius,
      // The system's own opening animation would play over the glass.
      setPresenting: (window, presenting) =>
        setWindowAnimates(window, !presenting),
      ownerWindow: (projectId) => {
        // Every window holds the temporary workspace; a new one takes it.
        if (isTemporaryWorkspace(projectId)) return null;
        const ownerId = this.requireCore().runtimes.ownerOfProject(projectId);
        return (
          (ownerId !== undefined && options.windowForClient(ownerId)) || null
        );
      },
      deliver: (window, handoff) => {
        window.webContents.send(DELIVER_QUICK_COMPOSER_CHANNEL, handoff);
        options.focus(window);
      },
      createHandoffWindow: (bounds) =>
        windows.create({ bounds, quickComposerHandoff: true }),
      captureContext: () => {
        const app = frontmostApp();
        const root = options.core()?.projectsRoot;
        if (!app || !root) return null;
        // Pine-managed storage of the temporary workspace, which every window
        // may preview and the message may be sent from.
        return () =>
          captureAppContext(
            app,
            path.join(
              root,
              TEMPORARY_WORKSPACE_PROJECT_ID,
              PROJECT_ATTACHMENTS_DIRECTORY,
            ),
          );
      },
      discardContext: (attachments) => void discardAppContext(attachments),
    });
  }

  /** Turns the shortcut on as saved, once the core is ready. */
  start(savedEnabled: boolean): void {
    this.enabled = savedEnabled && this.applyShortcut(true);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Whether a window belongs to the composer rather than to the user. */
  isAuxiliary(window: BrowserWindow): boolean {
    return this.controller.isAuxiliary(window);
  }

  dispose(): void {
    globalShortcut.unregisterAll();
    this.controller.dispose();
  }

  registerRequests(core: PineCore): void {
    core.handle(GET_QUICK_COMPOSER_CHANNEL, (): boolean => this.enabled);
  }

  registerIpc(): void {
    const quickComposer = this.controller;

    ipcMain.handle(
      SET_QUICK_COMPOSER_CHANNEL,
      async (_event, request: unknown): Promise<SetQuickComposerResult> => {
        const { enabled } = z.object({ enabled: z.boolean() }).parse(request);
        const registered = this.applyShortcut(enabled);
        // A shortcut another app holds leaves the feature off.
        const applied = enabled && registered;
        await writeQuickComposerEnabled(
          this.requireCore().agentDirectory,
          applied,
        );
        this.enabled = applied;
        return { enabled: applied, registered };
      },
    );

    ipcMain.handle(HIDE_QUICK_COMPOSER_CHANNEL, (event): void => {
      if (quickComposer.isPanel(event.sender)) quickComposer.hide();
    });

    ipcMain.handle(
      SET_QUICK_COMPOSER_PASS_THROUGH_CHANNEL,
      (event, passThrough: unknown): void => {
        if (
          quickComposer.isPanel(event.sender) &&
          typeof passThrough === "boolean"
        )
          quickComposer.setPassThrough(passThrough);
      },
    );

    ipcMain.handle(
      SET_QUICK_COMPOSER_GLASS_CHANNEL,
      (event, rect: unknown): boolean =>
        quickComposer.isPanel(event.sender) &&
        quickComposer.setGlass(QuickComposerRectSchema.parse(rect)),
    );

    ipcMain.handle(
      SUBMIT_QUICK_COMPOSER_CHANNEL,
      (event, request: unknown): number | null | undefined => {
        if (!quickComposer.isPanel(event.sender)) return undefined;
        // Previews of attachments picked here are granted to any window, so
        // the new one shows them too.
        return quickComposer.submit(SubmitQuickComposerSchema.parse(request));
      },
    );

    ipcMain.handle(
      REQUEST_QUICK_COMPOSER_PERMISSION_CHANNEL,
      async (event, request: unknown): Promise<void> => {
        if (!quickComposer.isPanel(event.sender)) return;
        const permission = z.enum(["accessibility", "screen"]).parse(request);
        // The system lists Pine there, or asks to add it to the list.
        if (permission === "accessibility")
          systemPreferences.isTrustedAccessibilityClient(true);
        else
          await shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
          );
        quickComposer.hide();
      },
    );

    ipcMain.handle(
      TAKE_QUICK_COMPOSER_HANDOFF_CHANNEL,
      (event): Promise<QuickComposerHandoff | null> =>
        quickComposer.takeHandoff(event.sender),
    );

    ipcMain.handle(
      PRESENT_QUICK_COMPOSER_HANDOFF_CHANNEL,
      (event, rect: unknown): void => {
        quickComposer.present(
          event.sender.id,
          QuickComposerRectSchema.parse(rect),
        );
      },
    );
  }

  private requireCore(): PineCore {
    const core = this.options.core();
    if (!core) throw new Error("Pine is not ready.");
    return core;
  }

  /** Registers or releases the global shortcut; false when another app has it. */
  private applyShortcut(enabled: boolean): boolean {
    if (!enabled) {
      if (globalShortcut.isRegistered(QUICK_COMPOSER_ACCELERATOR))
        globalShortcut.unregister(QUICK_COMPOSER_ACCELERATOR);
      this.controller.dispose();
      return true;
    }
    if (globalShortcut.isRegistered(QUICK_COMPOSER_ACCELERATOR)) return true;
    const registered = globalShortcut.register(QUICK_COMPOSER_ACCELERATOR, () =>
      this.controller.toggle(),
    );
    if (registered) this.controller.warmUp();
    return registered;
  }
}
