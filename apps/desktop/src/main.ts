import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
  webContents,
} from "electron";
import started from "electron-squirrel-startup";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SYSTEM_LANGUAGES_ENV } from "./agent/network-region";
import {
  readPineAgentSettings,
  writeRemoteKeepAwake,
  writeRunInBackground,
} from "./agent/pineSettings";
import { ATTACHMENT_IMAGE_PROTOCOL } from "./shared/attachments";
import { expandHomePath } from "./main/homePath";
import {
  DEFAULT_RUN_IN_BACKGROUND,
  GET_RUN_IN_BACKGROUND_CHANNEL,
  SET_RUN_IN_BACKGROUND_CHANNEL,
} from "./shared/background";
import {
  CURRENCY_PREFERENCE_KEY,
  PREFERENCES_ADOPT_WEB_STORAGE_CHANNEL,
  PREFERENCES_REMOVE_CHANNEL,
  PREFERENCES_SET_CHANNEL,
  PREFERENCES_SNAPSHOT_CHANNEL,
} from "./shared/preferenceStorage";
import { PROJECT_MEDIA_PROTOCOL } from "./shared/projectFiles";
import {
  LIBRARY_CHANGED_CHANNEL,
  SESSIONS_DELETED_CHANNEL,
} from "./shared/projects";
import { AUTOMATIONS_CHANGED_CHANNEL } from "./shared/automation";
import {
  automationLocale,
  desktopAutomationPower,
  showAutomationNotification,
} from "./main/desktop/automationHost";
import { DEFAULT_QUICK_COMPOSER_ENABLED } from "./shared/quickComposer";
import {
  CANCEL_REMOTE_PAIRING_CHANNEL,
  DEFAULT_REMOTE_STATUS,
  GET_REMOTE_CONTROL_CHANNEL,
  MAX_REMOTE_DEVICE_NAME_LENGTH,
  REMOTE_CONTROL_CHANGED_CHANNEL,
  REMOVE_REMOTE_DEVICE_CHANNEL,
  RENAME_REMOTE_DEVICE_CHANNEL,
  SET_REMOTE_CONTROL_ENABLED_CHANNEL,
  START_REMOTE_PAIRING_CHANNEL,
  type RemoteStatus,
} from "./shared/remoteControl";
import {
  CHECK_FOR_UPDATE_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  UPDATE_EVENT_CHANNEL,
  type DownloadUpdateResult,
  type InstallUpdateResult,
  type PineUpdateEvent,
  type UpdateCheckResult,
} from "./shared/updates";
import {
  DEFAULT_WEB_SERVER_SETTINGS,
  GET_WEB_SERVER_CHANNEL,
  MIN_WEB_PASSWORD_LENGTH,
  SET_WEB_PASSWORD_CHANNEL,
  SET_WEB_SERVER_CHANNEL,
  SIGN_OUT_WEB_BROWSERS_CHANNEL,
  isWebServerSettings,
  type WebServerSettings,
} from "./shared/webControl";
import type { WindowsSandboxStatus } from "./shared/windowsSandbox";
import {
  OPEN_PREFERENCES_SECTION_CHANNEL,
  TAKE_PENDING_PREFERENCES_SECTION_CHANNEL,
} from "./shared/window";
import { AppUpdater, readUpdateManifestUrl } from "./main/appUpdater";
import {
  notifyPreferenceChange,
  PreferenceStore,
} from "./main/preferenceStore";
import type { PineHost } from "./main/core/host";
import { PineCore } from "./main/core/pineCore";
import {
  currentAppLocale,
  DesktopAttention,
  isChineseLocale,
} from "./main/desktop/attention";
import { DesktopBackground } from "./main/desktop/background";
import { registerNativeIpc } from "./main/desktop/nativeIpc";
import {
  broadcastRemoteKeepAwake,
  createPowerBlocker,
  registerRemoteKeepAwakeIpc,
} from "./main/desktop/remoteKeepAwake";
import {
  createLiveContext,
  createWeChatVoiceTranscriber,
} from "./main/desktop/liveContext";
import { answerLiveContextOperation } from "./shared/liveContextAgent";
import { answerLiveContextCapture } from "./main/liveContextCapture";
import {
  createRemoteKeepAwakeSetting,
  isRemoteAccessOn,
  migrateRemoteKeepAwake,
  RemoteKeepAwake,
} from "./main/remoteKeepAwake";
import type { RemoteKeepAwakeStatus } from "./shared/remoteKeepAwake";
import {
  broadcastWeChatStatus,
  registerWeChatIpc,
  showWeChatNotification,
  type WeChatNotificationTarget,
} from "./main/desktop/wechatHost";
import { DesktopQuickComposer } from "./main/desktop/quickComposer";
import {
  DesktopWindows,
  rendererDevUrl,
  rendererRoot,
} from "./main/desktop/windows";
import { serveProjectMediaRequest } from "./main/projectFilePreview";
import {
  hasQuitBlockers,
  quitConfirmationText,
  switchUserConfirmationText,
  type QuitBlockers,
} from "./main/quitGuard";
import {
  launchUser,
  relaunchArguments,
  UserRegistry,
  UserRegistryError,
} from "./main/users";
import {
  CHOOSE_USER_CHANNEL,
  CREATE_USER_CHANNEL,
  DELETE_USER_CHANNEL,
  GET_USERS_CHANNEL,
  isUserAvatar,
  isUserColor,
  MAX_USER_NAME_LENGTH,
  PRIMARY_USER_ID,
  SET_ASK_AT_LAUNCH_CHANNEL,
  SWITCH_USER_CHANNEL,
  UPDATE_USER_CHANNEL,
  USER_ARGUMENT_PREFIX,
  USER_PICKER_ROUTE_HASH,
  USERS_CHANGED_CHANNEL,
  type PineUser,
  type PineUsersState,
  type SwitchPineUserResult,
} from "./shared/users";
import {
  ensureWindowsSandboxReady,
  releaseWindowsSandboxRuntimeAccess,
  type WindowsSandboxSetupChoice,
} from "./main/windowsSandbox";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

if (process.platform === "win32") {
  // Squirrel uses this identity for shortcuts and taskbar pinning.
  app.setAppUserModelId("com.squirrel.Pine.Pine");
}

const isSmokeTest = process.argv.includes("--smoke-test");

/**
 * One Pine per data folder: a second launch brings the running one forward
 * instead of opening the same users' data twice. Development builds share
 * the installed app's folder and keep running beside it, as before.
 */
const instanceLock: Promise<boolean> =
  app.isPackaged && !isSmokeTest
    ? acquireInstanceLock()
    : Promise.resolve(true);

app.on("second-instance", () => openPine());

async function acquireInstanceLock(): Promise<boolean> {
  if (app.requestSingleInstanceLock()) return true;
  // A switch of user relaunches while the old process may still be exiting.
  if (
    !process.argv.some((argument) => argument.startsWith(USER_ARGUMENT_PREFIX))
  )
    return false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (app.requestSingleInstanceLock()) return true;
  }
  return false;
}

// Must run before app ready. The attachment image protocol lets the renderer
// display local images without granting it general filesystem access.
protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
    scheme: PROJECT_MEDIA_PROTOCOL,
  },
  {
    privileges: { standard: true, stream: true, supportFetchAPI: true },
    scheme: ATTACHMENT_IMAGE_PROTOCOL,
  },
]);

const ATTACHMENT_IMAGE_CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

nativeTheme.themeSource = "system";

/** Set once the app is ready; everything shared with the server lives here. */
let core: PineCore | null = null;

const users = new UserRegistry({
  userData: app.getPath("userData"),
  trash: (folder) => shell.trashItem(folder),
  primaryName: async () =>
    (await readPineAgentSettings(path.join(app.getPath("userData"), "agent")))
      .userProfile?.nickname ?? "",
});
/** The user Pine runs as; null while "Who's using Pine?" is showing. */
let currentUserId: string | null = null;
/** Settles with the user chosen in "Who's using Pine?". */
let pendingUserChoice: ((userId: string) => void) | null = null;
let userPickerWindow: BrowserWindow | null = null;
/** The users as last read, for the tray menu, which is built synchronously. */
let knownUsers: PineUser[] = [];
let appUpdater: AppUpdater | null = null;
let windowsSandboxReady = process.platform !== "win32";
let windowsSandboxSetupPromise: Promise<boolean> | null = null;

function requireCore(): PineCore {
  if (!core) throw new Error("Pine is not ready.");
  return core;
}

const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(app.getAppPath(), "resources/icon.png");

function windowForWebContentsId(
  webContentsId: number,
): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (window) =>
      !window.isDestroyed() && window.webContents.id === webContentsId,
  );
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function ownerWindow(ownerId: number): BrowserWindow | undefined {
  const sender = webContents.fromId(ownerId);
  const window = sender ? BrowserWindow.fromWebContents(sender) : undefined;
  return window && !window.isDestroyed() ? window : undefined;
}

const attention = new DesktopAttention(requireCore, ownerWindow);

const windows = new DesktopWindows({
  iconPath: appIconPath,
  ...(isSmokeTest && { smokeTestReady: () => app.exit(0) }),
  canOpenWorkspace: () => core !== null,
  mediaSources: () => {
    const pine = core;
    if (!pine) return undefined;
    return {
      attachment: (resolvedPath) =>
        pine.isServableAttachmentRequest(resolvedPath),
      project: (owner, input) => pine.previewPath(owner, input),
      presented: (owner, input) => pine.presentedFilePath(owner, input),
    };
  },
  record: (event, details) => core?.diagnostics.record(event, details),
  focused: () => attention.clearApprovalAttention(),
  destroyed: (webContentsId) => core?.releaseClient(webContentsId),
});
windows.registerIpc();

const quickComposer = new DesktopQuickComposer({
  core: () => core,
  windows,
  windowForClient: windowForWebContentsId,
  focus: focusWindow,
  watchReply: (sessionId) => attention.watchReply(sessionId),
});
quickComposer.registerIpc();

const trayIconDirectory = app.isPackaged
  ? path.join(process.resourcesPath, "tray")
  : path.join(app.getAppPath(), "resources/tray");

const background = new DesktopBackground({
  iconDirectory: trayIconDirectory,
  appWindows: () => appWindows(),
  open: () => openPine(),
  quit: () => app.quit(),
  toggleQuickComposer: () => quickComposer.controller.toggle(),
  toggleWebAccess: () => void toggleWebAccess(),
  toggleRelayRemote: () => void toggleRelayRemote(),
  toggleWeChat: () => void toggleWeChat(),
  toggleKeepAwake: () => void toggleKeepAwake(),
  manageRemote: () => openPreferencesSection("remote"),
  switchUser: (userId) => void switchUser(userId).catch(showUserError),
  state: () => ({
    ...currentQuitBlockers(),
    quickComposerEnabled: quickComposer.isEnabled(),
    webAccess: core?.web.server.status().enabled ?? false,
    relayRemote: core?.remote.status().enabled ?? false,
    wechatBound: core?.wechat.status().bound ?? false,
    keepAwake: remoteKeepAwake.enabled,
    ...(core ? { assistant: core.assistant.trayStatus() } : {}),
    users: knownUsers.map((user) => ({
      id: user.id,
      name: user.name,
      current: user.id === currentUserId,
    })),
  }),
});

/** Windows the user sees as Pine's, without the quick composer's own. */
function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (window) => !quickComposer.isAuxiliary(window),
  );
}

function createWindow(): BrowserWindow {
  return windows.create();
}

/**
 * Brings Pine forward from the tray, the Dock or the second instance: what
 * the tray hid, else a window that is open, else a new one.
 */
function openPine(): void {
  if (!core) {
    // Until someone is chosen, the only window is "Who's using Pine?".
    if (pendingUserChoice) showUserPicker();
    return;
  }
  if (background.showHiddenWindows()) return;
  const [existing] = appWindows();
  if (existing) {
    focusWindow(existing);
    return;
  }
  if (process.platform === "win32" && !isSmokeTest) {
    void ensureAppWindowsSandboxReady().then((ready) => {
      if (ready && appWindows().length === 0) {
        createWindow();
      } else if (!ready) {
        app.quit();
      }
    });
  } else {
    createWindow();
  }
}

/**
 * "Keep the computer awake while remote control is on": holds a sleep blocker
 * while the setting is on and Browser access runs or WeChat receives tasks.
 * Refreshed on remote events only.
 */
const remoteKeepAwake = new RemoteKeepAwake({
  remoteOn: () =>
    core
      ? isRemoteAccessOn({
          browserAccess: core.web.server.isRunning(),
          wechatListening: core.wechat.isListening(),
          wechatNeedsScan:
            core.wechat.status().connection === "reauth-required",
        })
      : false,
  block: createPowerBlocker(),
  changed: broadcastRemoteKeepAwake,
});

/** Saves the setting first, then applies it; shared by the settings page and the tray. */
let remoteKeepAwakeSetting:
  ReturnType<typeof createRemoteKeepAwakeSetting> | undefined;

async function setRemoteKeepAwake(
  enabled: boolean,
): Promise<RemoteKeepAwakeStatus> {
  if (!remoteKeepAwakeSetting) throw new Error("Pine is still starting.");
  return remoteKeepAwakeSetting.set(enabled);
}

/**
 * The window a WeChat notification leads to: the one holding its project,
 * else any of Pine's, else a new one.
 */
function wechatNotificationWindow(
  target: WeChatNotificationTarget,
): BrowserWindow | undefined {
  const ownerId = target.projectId
    ? core?.runtimes.ownerOfProject(target.projectId)
    : undefined;
  const owner =
    ownerId === undefined ? undefined : windowForWebContentsId(ownerId);
  if (owner) return owner;
  const [existing] = appWindows();
  if (existing) return existing;
  openPine();
  return undefined;
}

/** What the shared application needs from Electron. */
/** On-device transcription of WeChat voice messages, where it can run. */
function wechatVoice(): Pick<PineHost, "transcribeVoice"> {
  const transcribeVoice = createWeChatVoiceTranscriber({
    uiLocale: currentAppLocale,
    temporaryDirectory: path.join(app.getPath("temp"), "pine-wechat-voice"),
  });
  return transcribeVoice ? { transcribeVoice } : {};
}

function desktopHost(dataDirectory: string): PineHost {
  return {
    dataDirectory,
    logsDirectory: app.getPath("logs"),
    geoipDatabasePath: app.isPackaged
      ? path.join(process.resourcesPath, "dbip-city-lite.mmdb.gz")
      : path.join(app.getAppPath(), "resources/geoip/dbip-city-lite.mmdb.gz"),
    version: app.getVersion(),
    systemRegion: app.getLocaleCountryCode() || undefined,
    runtime: { electron: process.versions.electron },
    // net.fetch goes through the system proxy, like the rest of Pine's traffic.
    fetch: (url, init) => net.fetch(url, init),
    createAgentProcess: () =>
      utilityProcess.fork(path.join(__dirname, "agent.mjs"), [], {
        serviceName: "Pine Agent",
        stdio: "pipe",
        env: {
          ...process.env,
          [SYSTEM_LANGUAGES_ENV]: app.getPreferredSystemLanguages().join(","),
        },
      }),
    credentialStorage: safeStorage,
    renderer: { root: rendererRoot(), devUrl: rendererDevUrl() },
    fileActions: {
      trash: (filePath) => shell.trashItem(filePath),
      open: (filePath) => shell.openPath(filePath),
      reveal: (filePath) => shell.showItemInFolder(filePath),
      copyPath: (filePath) => clipboard.writeText(filePath),
    },
    sendToClient: (clientId, channel, value) => {
      const target = webContents.fromId(clientId);
      if (!target || target.isDestroyed()) return false;
      target.send(channel, value);
      return true;
    },
    isQuickComposerClient: (clientId) => {
      const contents = webContents.fromId(clientId);
      return Boolean(contents && quickComposer.controller.isPanel(contents));
    },
    focusClient: (clientId) => {
      const window = windowForWebContentsId(clientId);
      if (window) focusWindow(window);
      return window !== undefined;
    },
    libraryChanged: (change, sourceClientId) => {
      for (const window of appWindows())
        if (!window.isDestroyed() && window.webContents.id !== sourceClientId)
          window.webContents.send(LIBRARY_CHANGED_CHANNEL, change);
    },
    sessionsDeleted: (sessionIds) => {
      for (const window of appWindows())
        if (!window.isDestroyed())
          window.webContents.send(SESSIONS_DELETED_CHANNEL, sessionIds);
    },
    observeAgentEvent: (event, ownerId) => attention.observe(event, ownerId),
    liveContext: async (target, operation) =>
      operation.op === "increment" || operation.op === "read"
        ? answerLiveContextOperation(
            await liveContext.agentSource(target),
            operation,
          )
        : {
            op: "capture",
            capture: await answerLiveContextCapture(
              liveContext,
              target,
              operation,
              {
                uiLocale: currentAppLocale,
              },
            ),
          },
    approveRemotePairing: confirmRemotePairing,
    remoteControlChanged: (status) => {
      broadcastRemoteStatus(status);
      remoteKeepAwake.refresh();
    },
    attentionNotificationsChanged: (enabled) => {
      if (!enabled) attention.closeAttentionNotifications();
    },
    automationPower: desktopAutomationPower(),
    notifyAutomation: (notification) =>
      showAutomationNotification(notification, () =>
        appWindows().find((window) => !window.isDestroyed()),
      ),
    automationsChanged: (event) => {
      for (const window of appWindows())
        if (!window.isDestroyed())
          window.webContents.send(AUTOMATIONS_CHANGED_CHANNEL, event);
    },
    locale: automationLocale,
    currencyPreference: () => preferences().get(CURRENCY_PREFERENCE_KEY),
    wechatChanged: (status) => {
      broadcastWeChatStatus(status);
      remoteKeepAwake.refresh();
    },
    notifyWeChat: (notification) =>
      showWeChatNotification(notification, wechatNotificationWindow),
    ...wechatVoice(),
    // Automation approvals appear in this app's windows.
    localAutomationApprovals: true,
  };
}

/** Every shared request is also an IPC channel for desktop windows. */
function exposeRequestsOverIpc(pine: PineCore): void {
  for (const channel of pine.router.channels())
    ipcMain.handle(channel, (event, request: unknown) =>
      pine.router.invoke(
        channel,
        { clientId: event.sender.id, source: "desktop" },
        request,
      ),
    );
}

function registerAttachmentImageProtocol(): void {
  protocol.handle(ATTACHMENT_IMAGE_PROTOCOL, async (request) => {
    let requestedPath: string | null;
    try {
      requestedPath = new URL(request.url).searchParams.get("p");
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!requestedPath) {
      return new Response("Bad request", { status: 400 });
    }
    const resolvedPath = path.resolve(expandHomePath(requestedPath));
    if (!(await core?.isServableAttachmentRequest(resolvedPath))) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const contents = await readFile(resolvedPath);
      const extension = path.extname(resolvedPath).slice(1).toLowerCase();
      return new Response(contents, {
        headers: {
          "content-type":
            ATTACHMENT_IMAGE_CONTENT_TYPES[extension] ??
            "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function registerProjectMediaProtocol(): void {
  protocol.handle(PROJECT_MEDIA_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "preview")
        return new Response(null, { status: 400 });
      const ownerId = z.coerce
        .number()
        .int()
        .positive()
        .parse(url.searchParams.get("owner"));
      const pine = requireCore();
      return await serveProjectMediaRequest(request, ownerId, {
        project: (owner, input) => pine.previewPath(owner, input),
        presented: (owner, input) => pine.presentedFilePath(owner, input),
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function getAppUpdater(): AppUpdater {
  if (!appUpdater) throw new Error("App updater is not ready.");
  return appUpdater;
}

function broadcastUpdateEvent(event: PineUpdateEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_EVENT_CHANNEL, event);
    }
  }
}

ipcMain.handle(CHECK_FOR_UPDATE_CHANNEL, (): Promise<UpdateCheckResult> =>
  getAppUpdater().check(),
);

ipcMain.handle(
  DOWNLOAD_UPDATE_CHANNEL,
  async (): Promise<DownloadUpdateResult> => {
    try {
      return await getAppUpdater().download();
    } catch (error) {
      broadcastUpdateEvent({ message: String(error), type: "error" });
      throw error;
    }
  },
);

ipcMain.handle(
  INSTALL_UPDATE_CHANNEL,
  async (): Promise<InstallUpdateResult> => {
    // The user chose to restart into the update; the installer waits for exit.
    quitConfirmed = true;
    try {
      return await getAppUpdater().install();
    } catch (error) {
      quitConfirmed = false;
      broadcastUpdateEvent({ message: String(error), type: "error" });
      throw error;
    }
  },
);

/**
 * The current user's UI preferences. While "Who's using Pine?" shows, the
 * last user's, so the picker opens in their theme and language.
 */
let preferenceStore: PreferenceStore | null = null;
function preferences(): PreferenceStore {
  preferenceStore ??= new PreferenceStore(
    path.join(users.dataRoot(PRIMARY_USER_ID), "ui-preferences.json"),
  );
  return preferenceStore;
}
ipcMain.on(PREFERENCES_SNAPSHOT_CHANNEL, (event) => {
  event.returnValue = preferences().snapshot();
});
ipcMain.on(PREFERENCES_ADOPT_WEB_STORAGE_CHANNEL, (event) => {
  // Web storage is shared by every user; only the primary user's old
  // preferences were ever kept there.
  event.returnValue = currentUserId === PRIMARY_USER_ID;
});
const preferenceTargets = () =>
  BrowserWindow.getAllWindows().map((window) => window.webContents);
ipcMain.on(PREFERENCES_SET_CHANNEL, (event, key: unknown, value: unknown) => {
  if (preferences().set(key, value))
    notifyPreferenceChange(
      preferenceTargets(),
      event.sender.id,
      key as string,
      value as string,
    );
});
ipcMain.on(PREFERENCES_REMOVE_CHANNEL, (event, key: unknown) => {
  if (preferences().remove(key))
    notifyPreferenceChange(
      preferenceTargets(),
      event.sender.id,
      key as string,
      null,
    );
});

async function usersState(): Promise<PineUsersState> {
  const loaded = await users.load();
  knownUsers = loaded.users;
  return {
    users: loaded.users,
    currentUserId,
    lastUserId: loaded.lastUserId,
    askAtLaunch: loaded.askAtLaunch,
    damaged: loaded.damaged,
  };
}

/** Every window shows the users (sidebar, settings, picker). */
async function broadcastUsers(): Promise<PineUsersState> {
  const state = await usersState();
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send(USERS_CHANGED_CHANNEL, state);
  return state;
}

const UserInputSchema = z.object({
  name: z.string().max(MAX_USER_NAME_LENGTH * 4),
  avatar: z.custom<Parameters<typeof isUserAvatar>[0]>(
    (value) => value === null || isUserAvatar(value),
  ),
  color: z.custom<string>(isUserColor),
});

function userInput(request: z.infer<typeof UserInputSchema>) {
  return {
    name: request.name,
    avatar: isUserAvatar(request.avatar) ? request.avatar : null,
    color: isUserColor(request.color) ? request.color : "green",
  };
}

/** Registry refusals reach the renderer with a code it can explain. */
async function userChange(
  run: () => Promise<unknown>,
): Promise<PineUsersState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof UserRegistryError)
      throw new Error(`${error.code}: ${error.message}`);
    throw error;
  }
  return broadcastUsers();
}

ipcMain.handle(GET_USERS_CHANNEL, () => usersState());
ipcMain.handle(CREATE_USER_CHANNEL, (_event, request: unknown) => {
  const parsed = UserInputSchema.extend({
    copyModelConnections: z.boolean(),
  }).parse(request);
  return userChange(() =>
    users.create(
      userInput(parsed),
      // Only a running user has connections to copy; the picker never does.
      parsed.copyModelConnections && currentUserId ? currentUserId : undefined,
    ),
  );
});
ipcMain.handle(UPDATE_USER_CHANNEL, (_event, request: unknown) => {
  const parsed = UserInputSchema.extend({
    id: z.string().min(1).max(64),
  }).parse(request);
  return userChange(() => users.update(parsed.id, userInput(parsed)));
});
ipcMain.handle(DELETE_USER_CHANNEL, (_event, request: unknown) => {
  const id = z.string().min(1).max(64).parse(request);
  // Nobody is deleted from the picker: their data is not open to check.
  if (!currentUserId) throw new Error("protected: Choose a user first.");
  return userChange(() => users.remove(id, currentUserId));
});
ipcMain.handle(SET_ASK_AT_LAUNCH_CHANNEL, (_event, request: unknown) => {
  const ask = z.boolean().parse(request);
  return userChange(() => users.setAskAtLaunch(ask));
});
ipcMain.handle(CHOOSE_USER_CHANNEL, async (_event, request: unknown) => {
  const { id, remember } = z
    .object({ id: z.string().min(1).max(64), remember: z.boolean() })
    .parse(request);
  const choose = pendingUserChoice;
  if (!choose) throw new Error("Pine is already running as a user.");
  const loaded = await users.load();
  if (!loaded.users.some((user) => user.id === id))
    throw new Error("not-found: Unknown user.");
  if (remember && !loaded.damaged) await users.setAskAtLaunch(false);
  choose(id);
});
ipcMain.handle(
  SWITCH_USER_CHANNEL,
  (_event, request: unknown): Promise<SwitchPineUserResult> =>
    switchUser(z.string().min(1).max(64).parse(request)),
);

/** Restarts Pine as another user, asking first if work would be cut off. */
async function switchUser(id: string): Promise<SwitchPineUserResult> {
  if (!core || id === currentUserId) return "cancelled";
  const target = (await users.load()).users.find((user) => user.id === id);
  if (!target) throw new Error("not-found: Unknown user.");
  const blockers = currentQuitBlockers();
  if (hasQuitBlockers(blockers)) {
    const text = switchUserConfirmationText(
      blockers,
      isChineseLocale(),
      target.name || (isChineseLocale() ? "我" : "Me"),
    );
    const options = {
      type: "warning" as const,
      ...text,
      cancelId: 1,
      defaultId: 0,
      noLink: true,
    };
    const parent = BrowserWindow.getFocusedWindow();
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) return "cancelled";
  }
  quitConfirmed = true;
  background.markQuitting();
  app.relaunch({ args: relaunchArguments(process.argv.slice(1), id) });
  await core.stop();
  app.quit();
  return "restarting";
}

function showUserError(error: unknown): void {
  dialog.showErrorBox(
    "Pine",
    String(error instanceof Error ? error.message : error),
  );
}

ipcMain.handle(
  GET_RUN_IN_BACKGROUND_CHANNEL,
  (): boolean => background.enabled,
);
ipcMain.handle(
  SET_RUN_IN_BACKGROUND_CHANNEL,
  async (_event, request: unknown): Promise<boolean> => {
    const enabled = z.boolean().parse(request);
    const applied = background.apply(enabled);
    // Without a tray to return from, the preference stays off.
    await writeRunInBackground(requireCore().agentDirectory, applied);
    return applied;
  },
);

ipcMain.handle(
  GET_WEB_SERVER_CHANNEL,
  () =>
    core?.web.server.status() ?? {
      ...DEFAULT_WEB_SERVER_SETTINGS,
      hasPassword: false,
    },
);
ipcMain.handle(SET_WEB_SERVER_CHANNEL, async (_event, request: unknown) => {
  const settings = z
    .custom<WebServerSettings>(isWebServerSettings)
    .parse(request);
  if (!core) throw new Error("The local web interface is not ready.");
  try {
    const status = await core.web.configure(settings, true);
    // Phones reach Pine through this server, so their settings change with it.
    broadcastRemoteStatus(core.remote.status());
    return status;
  } finally {
    remoteKeepAwake.refresh();
  }
});
ipcMain.handle(SET_WEB_PASSWORD_CHANNEL, async (_event, request: unknown) => {
  const password = z
    .string()
    .min(MIN_WEB_PASSWORD_LENGTH)
    .max(1_024)
    .parse(request);
  if (!core) throw new Error("The local web interface is not ready.");
  return core.web.setPassword(password);
});
ipcMain.handle(SIGN_OUT_WEB_BROWSERS_CHANNEL, async () => {
  if (!core) throw new Error("The local web interface is not ready.");
  return core.web.signOutAll();
});

function broadcastRemoteStatus(status: RemoteStatus): void {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send(REMOTE_CONTROL_CHANGED_CHANNEL, status);
}

function remoteHost(): PineCore["remote"] {
  if (!core) throw new Error("Remote Control is not ready.");
  return core.remote;
}

// Desktop only: none of these are in the web request policy, so a paired
// phone cannot pair others or change what may connect.
ipcMain.handle(
  GET_REMOTE_CONTROL_CHANNEL,
  (): RemoteStatus => core?.remote.status() ?? DEFAULT_REMOTE_STATUS,
);
ipcMain.handle(
  SET_REMOTE_CONTROL_ENABLED_CHANNEL,
  async (_event, request: unknown) => {
    const host = remoteHost();
    if (z.boolean().parse(request)) await host.enable();
    else await host.disable();
    return host.status();
  },
);
ipcMain.handle(START_REMOTE_PAIRING_CHANNEL, async () => {
  const host = remoteHost();
  await host.startPairing();
  return host.status();
});
ipcMain.handle(CANCEL_REMOTE_PAIRING_CHANNEL, () => {
  const host = remoteHost();
  host.cancelPairing();
  return host.status();
});
ipcMain.handle(
  RENAME_REMOTE_DEVICE_CHANNEL,
  async (_event, request: unknown) => {
    const { id, name } = z
      .object({
        id: z.string().min(1).max(200),
        name: z.string().trim().min(1).max(MAX_REMOTE_DEVICE_NAME_LENGTH),
      })
      .parse(request);
    const host = remoteHost();
    await host.renameDevice(id, name);
    return host.status();
  },
);
ipcMain.handle(
  REMOVE_REMOTE_DEVICE_CHANNEL,
  async (_event, request: unknown) => {
    const id = z.string().min(1).max(200).parse(request);
    const host = remoteHost();
    await host.removeDevice(id);
    return host.status();
  },
);

// Desktop only, like Remote Control's: registered on ipcMain, not the router.
registerWeChatIpc(() => core);
registerRemoteKeepAwakeIpc({
  controller: remoteKeepAwake,
  set: setRemoteKeepAwake,
});
const liveContext = createLiveContext({
  projectRoot: (projectId) => {
    if (!core) throw new Error("Pine is still starting.");
    return core.repository.dataPaths(projectId).projectRoot;
  },
  createSession: (clientId, projectId, approvalMode) => {
    if (!core) throw new Error("Pine is still starting.");
    return core.runtimes.createLiveContextSession(
      clientId,
      projectId,
      approvalMode,
    );
  },
  translate: (request) => {
    if (!core) throw new Error("Pine is still starting.");
    return core.runtimes.translateLiveContext(request);
  },
});

/** A section asked for before the window's renderer could listen. */
let pendingPreferencesSection: string | null = null;

ipcMain.handle(TAKE_PENDING_PREFERENCES_SECTION_CHANNEL, () => {
  const section = pendingPreferencesSection;
  pendingPreferencesSection = null;
  return section;
});

/** Brings Pine forward and opens its preferences at `section`. */
function openPreferencesSection(section: string): void {
  const hadWindow = appWindows().length > 0;
  pendingPreferencesSection = section;
  openPine();
  const window = BrowserWindow.getFocusedWindow() ?? appWindows()[0];
  // A window still loading picks the section up when its view mounts.
  if (!hadWindow || !window || window.webContents.isLoading()) return;
  pendingPreferencesSection = null;
  window.webContents.send(OPEN_PREFERENCES_SECTION_CHANNEL, section);
}

/** The tray's switch for browser access; saved like the settings page does. */
async function toggleWebAccess(): Promise<void> {
  if (!core) return;
  try {
    const { enabled, port, lan, rememberFor, requirePassword, publicOrigin } =
      core.web.server.status();
    await core.web.configure(
      {
        enabled: !enabled,
        port,
        lan,
        rememberFor,
        requirePassword,
        ...(publicOrigin ? { publicOrigin } : {}),
      },
      true,
    );
    broadcastRemoteStatus(core.remote.status());
  } catch (error) {
    dialog.showErrorBox(
      "Pine",
      String(error instanceof Error ? error.message : error),
    );
  } finally {
    remoteKeepAwake.refresh();
  }
}

async function toggleRelayRemote(): Promise<void> {
  if (!core) return;
  try {
    if (core.remote.status().enabled) await core.remote.disable();
    else await core.remote.enable();
  } catch (error) {
    dialog.showErrorBox(
      "Pine",
      String(error instanceof Error ? error.message : error),
    );
  }
}

/** The tray's WeChat switch: the same pause flag as the settings page's. */
async function toggleWeChat(): Promise<void> {
  if (!core) return;
  try {
    const status = core.wechat.status();
    if (!status.bound) return;
    await core.wechat.setPaused(!status.paused);
  } catch (error) {
    dialog.showErrorBox(
      "Pine",
      String(error instanceof Error ? error.message : error),
    );
  }
}

/** The tray's keep-awake switch: the same setting as the settings page's. */
async function toggleKeepAwake(): Promise<void> {
  if (!core) return;
  try {
    await setRemoteKeepAwake(!remoteKeepAwake.enabled);
  } catch (error) {
    dialog.showErrorBox(
      "Pine",
      String(error instanceof Error ? error.message : error),
    );
  }
}

/** A new phone only pairs once the person at this computer says yes. */
async function confirmRemotePairing(request: {
  fingerprint: string;
}): Promise<boolean> {
  const chinese = isChineseLocale();
  const options = {
    type: "question" as const,
    title: chinese ? "允许这台设备？" : "Allow this device?",
    message: chinese
      ? "有一台设备想要远程控制这台电脑上的 Pine。"
      : "A device wants to control Pine on this computer.",
    detail: chinese
      ? `设备的密钥指纹：${request.fingerprint}\n只有你刚刚扫描了配对二维码或打开了配对链接才应允许。`
      : `Device key fingerprint: ${request.fingerprint}\nAllow it only if you just scanned the pairing code or opened the pairing link.`,
    buttons: chinese ? ["允许", "拒绝"] : ["Allow", "Deny"],
    cancelId: 1,
    defaultId: 1,
    noLink: true,
  };
  const parent =
    BrowserWindow.getFocusedWindow() ?? background.visibleWindows()[0];
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}

async function showWindowsSandboxSetupDialog(
  status: WindowsSandboxStatus,
): Promise<WindowsSandboxSetupChoice> {
  const chinese = isChineseLocale();
  const cancelled = status.state === "not-installed" && status.cancelled;
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: chinese ? "需要配置 Windows 沙箱" : "Windows sandbox setup required",
    message: chinese
      ? "完成 Windows 沙箱配置后才能进入 Pine。"
      : "Pine cannot open until the Windows sandbox is configured.",
    detail: cancelled
      ? chinese
        ? "你取消了上一次 UAC 授权。点击“重试”再次打开 UAC 提示。"
        : "The last UAC request was cancelled. Choose Retry to show it again."
      : chinese
        ? "请在 UAC 提示中允许 Pine 完成配置。"
        : "Approve the UAC prompt so Pine can finish the setup.",
    buttons: chinese ? ["重试", "退出 Pine"] : ["Retry", "Exit Pine"],
    cancelId: 1,
    defaultId: 0,
    noLink: true,
  });
  return response === 0 ? "retry" : "exit";
}

async function ensureAppWindowsSandboxReady(): Promise<boolean> {
  if (windowsSandboxReady) return true;
  if (!windowsSandboxSetupPromise) {
    windowsSandboxSetupPromise = ensureWindowsSandboxReady({
      prompt: showWindowsSandboxSetupDialog,
    }).then((ready) => {
      windowsSandboxReady = ready;
      return ready;
    });
  }
  try {
    return await windowsSandboxSetupPromise;
  } catch (error) {
    console.error("[Windows sandbox] setup flow failed", error);
    windowsSandboxReady = false;
    return false;
  } finally {
    windowsSandboxSetupPromise = null;
  }
}

function recordSystemEvents(pine: PineCore): void {
  const { diagnostics } = pine;
  powerMonitor.on("suspend", () => diagnostics.record("power:suspend"));
  // The system is shutting down or logging out; never hold that up.
  powerMonitor.on("shutdown", () => {
    quitConfirmed = true;
    background.markQuitting();
  });
  powerMonitor.on("resume", () => {
    diagnostics.record("power:resume");
    // The long poll may have died in the sleep; reconnect now, not later.
    pine.wechat.wake();
  });
  powerMonitor.on("lock-screen", () => diagnostics.record("power:lock-screen"));
  powerMonitor.on("unlock-screen", () =>
    diagnostics.record("power:unlock-screen"),
  );
  app.on("child-process-gone", (_event, details) => {
    diagnostics.record("child-process:gone", {
      type: details.type,
      ...(details.name ? { name: details.name } : {}),
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
}

async function createAppUpdater(): Promise<AppUpdater> {
  const releaseConfigPath = app.isPackaged
    ? path.join(process.resourcesPath, "release.json")
    : path.join(app.getAppPath(), "../../.pine/release.json");
  const manifestUrl = app.isPackaged
    ? await readUpdateManifestUrl(releaseConfigPath)
    : null;
  return new AppUpdater({
    arch: process.arch,
    currentExecutable: process.execPath,
    currentVersion: app.getVersion(),
    emit: broadcastUpdateEvent,
    manifestUrl,
    platform: process.platform,
    quit: () => app.quit(),
    tempDirectory: app.getPath("temp"),
    windowsUpdater: process.platform === "win32" ? autoUpdater : undefined,
  });
}

// Called once Electron has finished initialization and can create browser
// windows. Some APIs can only be used after this event occurs.
async function initializeApp(): Promise<void> {
  // Before any window: a page only reaches the schemes registered when it
  // loads, and the floating composer's panel loads early.
  registerAttachmentImageProtocol();
  registerProjectMediaProtocol();
  // Dev runs inside Electron.app, so it cannot use Pine's bundle asset catalog.
  // Preview Apple's generated compatibility image here. Packaged apps retain
  // the native Icon Composer resource; never override it with dock.setIcon().
  if (!app.isPackaged) app.dock?.setIcon(appIconPath);

  // Windows agent tools rely on a one-time elevated sandbox installation. Keep
  // the renderer closed until that prerequisite is complete. Smoke tests are
  // intentionally non-interactive and must remain launch-only.
  if (process.platform === "win32" && !isSmokeTest) {
    if (!(await ensureAppWindowsSandboxReady())) {
      app.quit();
      return;
    }
  } else {
    windowsSandboxReady = true;
  }

  if (!(await instanceLock)) {
    app.quit();
    return;
  }
  const userId = await chooseLaunchUser();
  if (!userId) return;
  currentUserId = userId;
  preferenceStore = new PreferenceStore(
    path.join(users.dataRoot(userId), "ui-preferences.json"),
  );
  void users
    .markUsed(userId)
    .then(() => usersState())
    .catch((error: unknown) =>
      console.error("Could not remember the last user.", error),
    );
  const pine = await PineCore.create(desktopHost(users.dataRoot(userId)));
  core = pine;
  pine.diagnostics.record("user:start", {
    primary: userId === PRIMARY_USER_ID,
  });
  recordSystemEvents(pine);
  quickComposer.registerRequests(pine);
  exposeRequestsOverIpc(pine);
  registerNativeIpc(pine, quickComposer.controller);
  quickComposer.start(
    pine.settings.quickComposerEnabled ?? DEFAULT_QUICK_COMPOSER_ENABLED,
  );
  // Not awaited: the old WeChat switch may need the WeChat store to load.
  remoteKeepAwakeSetting = createRemoteKeepAwakeSetting({
    migrate: () =>
      migrateRemoteKeepAwake({
        stored: pine.settings.remoteKeepAwake,
        legacy: () => pine.wechat.legacyKeepAwake(),
        write: (value) => writeRemoteKeepAwake(pine.agentDirectory, value),
      }),
    write: (value) => writeRemoteKeepAwake(pine.agentDirectory, value),
    apply: (value) => remoteKeepAwake.setEnabled(value),
    onError: (error) =>
      console.error("Failed to read the keep-awake setting.", error),
  });
  // Smoke tests launch and exit; a tray would only outlive them.
  background.start(
    !isSmokeTest &&
      (pine.settings.runInBackground ?? DEFAULT_RUN_IN_BACKGROUND),
  );
  appUpdater = await createAppUpdater();
  if (pine.settings.webServer) {
    try {
      await pine.web.configure(pine.settings.webServer);
    } catch (error) {
      console.error("Failed to start the local web interface.", error);
    } finally {
      remoteKeepAwake.refresh();
    }
  }
  // The picker's window becomes the first workspace window.
  const picker = userPickerWindow;
  userPickerWindow = null;
  if (picker && !picker.isDestroyed()) windows.showWorkspace(picker);
  else createWindow();
}

/** Who Pine starts as: decided without asking when it can be. */
async function chooseLaunchUser(): Promise<string | undefined> {
  const loaded = await users.load();
  const decided = launchUser(loaded, process.argv);
  if (decided) return decided;
  // The picker shows in the last user's theme and language.
  preferenceStore = new PreferenceStore(
    path.join(users.dataRoot(loaded.lastUserId), "ui-preferences.json"),
  );
  const choice = new Promise<string>((resolve) => {
    pendingUserChoice = resolve;
  });
  showUserPicker();
  const userId = await choice;
  pendingUserChoice = null;
  return userId;
}

function showUserPicker(): void {
  if (userPickerWindow && !userPickerWindow.isDestroyed()) {
    focusWindow(userPickerWindow);
    return;
  }
  userPickerWindow = windows.create({ hash: USER_PICKER_ROUTE_HASH });
}

app.on("ready", () => {
  void initializeApp();
});

/** Set once the user agreed to quit, or the quit needs no confirmation. */
let quitConfirmed = false;
let quitConfirmation: Promise<void> | null = null;

function currentQuitBlockers(): QuitBlockers {
  return {
    remoteControl: core?.web.server.isRunning() ?? false,
    runningSessions: core?.runningWorkCount() ?? 0,
    wechat: core?.wechat.isListening() ?? false,
    wechatNeedsScan: core?.wechat.status().connection === "reauth-required",
  };
}

async function confirmQuit(blockers: QuitBlockers): Promise<void> {
  const text = quitConfirmationText(blockers, isChineseLocale());
  const options = {
    type: "warning" as const,
    ...text,
    cancelId: 1,
    defaultId: 0,
    noLink: true,
  };
  const parent =
    BrowserWindow.getFocusedWindow() ?? background.visibleWindows()[0];
  // From the tray there may be no window to anchor the question to.
  if (!parent) app.focus({ steal: true });
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) {
    // Closing the last window started this quit on Windows and Linux; keep a
    // window open so the running work stays reachable.
    if (process.platform !== "darwin" && appWindows().length === 0)
      createWindow();
    return;
  }
  quitConfirmed = true;
  await core?.stop();
  app.quit();
}

// Running sessions, Remote Control and WeChat remote end with Pine, so ask
// before quitting.
app.on("before-quit", (event) => {
  if (quitConfirmed || !hasQuitBlockers(currentQuitBlockers())) {
    // From here windows close for real instead of hiding in the tray.
    background.markQuitting();
    return;
  }
  const blockers = currentQuitBlockers();
  event.preventDefault();
  quitConfirmation ??= confirmQuit(blockers).finally(() => {
    quitConfirmation = null;
  });
});

app.on("will-quit", () => {
  quickComposer.dispose();
  background.dispose();
  remoteKeepAwake.dispose();
  liveContext.dispose();
  core?.dispose();
  releaseWindowsSandboxRuntimeAccess();
});

// Quit when all windows are closed, except on macOS and while Pine runs in
// the tray. There, it's common for applications and their menu bar to stay
// active until the user quits explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !background.active) {
    app.quit();
  }
});

// The quick composer's own windows keep running while it is enabled, so the
// last of the user's windows closing is what quits on Windows and Linux.
app.on("browser-window-created", (_event, window) => {
  // The panel is marked as the composer's only after its window exists.
  background.watch(window, () => quickComposer.isAuxiliary(window));
  window.once("closed", () => {
    if (
      process.platform !== "darwin" &&
      !background.active &&
      !quickComposer.isAuxiliary(window) &&
      appWindows().every((other) => other === window)
    )
      app.quit();
  });
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open. Until Pine is
  // ready, initialization opens the first window itself.
  if (background.visibleWindows().length === 0) openPine();
});
