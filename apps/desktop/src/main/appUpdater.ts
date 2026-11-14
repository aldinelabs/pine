import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { AutoUpdater } from "electron";
import {
  UPDATE_CHANGELOG_LOCALES,
  releaseNotesBetween,
  type DownloadUpdateResult,
  type InstallUpdateResult,
  type PineUpdateEvent,
  type PineReleaseNotes,
  type PineUpdateInfo,
  type UpdateCheckResult,
} from "../shared/updates";
import {
  compareVersions,
  isValidVersion,
  parseVersion,
} from "../shared/semver";

interface UpdateAsset {
  sha256: string;
  size: number;
  url: string;
}

interface UpdateManifest extends Omit<PineUpdateInfo, "releases"> {
  assets: Record<string, UpdateAsset>;
  /** Notes of earlier versions too, so a skipped range can be shown. */
  history?: PineReleaseNotes[];
  schemaVersion: 1;
}

export interface AppUpdaterOptions {
  arch: NodeJS.Architecture;
  currentVersion: string;
  currentExecutable: string;
  emit: (event: PineUpdateEvent) => void;
  fetch?: typeof fetch;
  manifestUrl: string | null;
  platform: NodeJS.Platform;
  quit: () => void;
  tempDirectory: string;
  windowsUpdater?: Pick<
    AutoUpdater,
    | "checkForUpdates"
    | "on"
    | "once"
    | "quitAndInstall"
    | "removeListener"
    | "setFeedURL"
  >;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;

export { compareVersions };

export function resolveCurrentAppPath(executablePath: string): string | null {
  const marker = ".app/Contents/MacOS/";
  const markerIndex = executablePath.indexOf(marker);
  if (markerIndex === -1) return null;
  return executablePath.slice(0, markerIndex + ".app".length);
}

export function resolveWindowsFeedUrl(
  manifestUrl: string,
  arch: NodeJS.Architecture,
): string {
  return new URL(`win32-${arch}/`, new URL(".", manifestUrl)).href;
}

function requireString(
  value: unknown,
  field: string,
  options: { nonEmpty?: boolean } = {},
): string {
  if (
    typeof value !== "string" ||
    (options.nonEmpty === true && value.trim().length === 0)
  ) {
    throw new Error(`Update manifest field ${field} is invalid`);
  }
  return value;
}

/** Per-language notes are optional: the combined changelog covers their absence. */
function parseChangelogs(
  value: unknown,
): PineUpdateInfo["changelogs"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const changelogs: NonNullable<PineUpdateInfo["changelogs"]> = {};
  for (const locale of UPDATE_CHANGELOG_LOCALES) {
    const changelog = (value as Record<string, unknown>)[locale];
    if (typeof changelog === "string" && changelog.trim().length > 0)
      changelogs[locale] = changelog;
  }
  return Object.keys(changelogs).length > 0 ? changelogs : undefined;
}

const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** History is optional, and unusable entries are dropped rather than fatal. */
function parseHistory(value: unknown): PineReleaseNotes[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const history: PineReleaseNotes[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.version !== "string" || !isValidVersion(raw.version))
      continue;
    const changelogs = parseChangelogs(raw.changelogs);
    if (!changelogs) continue;
    history.push({
      changelogs,
      ...(typeof raw.date === "string" && RELEASE_DATE_PATTERN.test(raw.date)
        ? { date: raw.date }
        : {}),
      version: raw.version,
    });
  }
  return history.length > 0 ? history : undefined;
}

/**
 * Notes for every version after `installed` up to the manifest's, or nothing
 * when the manifest carries no history. The manifest's own notes stand in when
 * its version is missing from the history.
 */
export function releasesForUpdate(
  manifest: Pick<UpdateManifest, "changelogs" | "history" | "version">,
  installed: string,
): PineReleaseNotes[] | undefined {
  if (!manifest.history) return undefined;
  const history = [...manifest.history];
  if (
    manifest.changelogs &&
    !history.some(
      (release) => compareVersions(release.version, manifest.version) === 0,
    )
  ) {
    history.push({
      changelogs: manifest.changelogs,
      version: manifest.version,
    });
  }
  const releases = releaseNotesBetween(history, installed, manifest.version);
  return releases.length > 0 ? releases : undefined;
}

export function parseUpdateManifest(
  input: unknown,
  manifestUrl: string,
): UpdateManifest {
  if (!input || typeof input !== "object") {
    throw new Error("Update manifest is not an object");
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported update manifest schema");
  }
  const version = requireString(value.version, "version", { nonEmpty: true });
  parseVersion(version);
  const internalVersion = requireString(
    value.internalVersion,
    "internalVersion",
    { nonEmpty: true },
  );
  const changelog = requireString(value.changelog, "changelog", {
    nonEmpty: true,
  });
  const changelogs = parseChangelogs(value.changelogs);
  const history = parseHistory(value.history);
  const publishedAt = requireString(value.publishedAt, "publishedAt", {
    nonEmpty: true,
  });
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error("Update manifest field publishedAt is invalid");
  }
  if (!value.assets || typeof value.assets !== "object") {
    throw new Error("Update manifest assets are invalid");
  }

  const manifestBase = new URL(".", manifestUrl);
  const assets: Record<string, UpdateAsset> = {};
  for (const [key, rawAsset] of Object.entries(
    value.assets as Record<string, unknown>,
  )) {
    if (!rawAsset || typeof rawAsset !== "object") {
      throw new Error(`Update asset ${key} is invalid`);
    }
    const asset = rawAsset as Record<string, unknown>;
    const url = new URL(
      requireString(asset.url, `${key}.url`, { nonEmpty: true }),
    );
    if (
      url.protocol !== "https:" ||
      url.origin !== manifestBase.origin ||
      !url.pathname.startsWith(manifestBase.pathname.replace(/latest\/$/, ""))
    ) {
      throw new Error(`Update asset ${key} must use the configured R2 origin`);
    }
    const sha256 = requireString(asset.sha256, `${key}.sha256`);
    const size = asset.size;
    if (!SHA256_PATTERN.test(sha256) || !Number.isSafeInteger(size)) {
      throw new Error(`Update asset ${key} metadata is invalid`);
    }
    if ((size as number) <= 0 || (size as number) > MAX_INSTALLER_BYTES) {
      throw new Error(`Update asset ${key} size is outside the allowed range`);
    }
    assets[key] = { sha256, size: size as number, url: url.href };
  }

  return {
    assets,
    changelog,
    ...(changelogs ? { changelogs } : {}),
    ...(history ? { history } : {}),
    internalVersion,
    publishedAt,
    schemaVersion: 1,
    version,
  };
}

export async function readUpdateManifestUrl(
  configPath: string,
): Promise<string | null> {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (config.r2?.enabled !== true) return null;
    const publicBaseUrl = new URL(config.r2.publicBaseUrl);
    if (
      publicBaseUrl.protocol !== "https:" ||
      publicBaseUrl.pathname !== "/" ||
      publicBaseUrl.search ||
      publicBaseUrl.hash
    )
      return null;
    const prefix = String(config.r2.prefix ?? "")
      .replace(/^\/+/, "")
      .replace(/\/*$/, "/");
    if (prefix.includes("..")) return null;
    return new URL(`${prefix}latest/update.json`, publicBaseUrl).href;
  } catch {
    return null;
  }
}

const INSTALL_HELPER = `#!/bin/sh
set -eu

DMG_PATH="$1"
PARENT_PID="$2"
TARGET_APP="/Applications/Pine.app"
HELPER_PATH="$0"
WORK_DIR=$(/usr/bin/mktemp -d "/tmp/pine-update.XXXXXX")
MOUNT_POINT="$WORK_DIR/mount"
STAGED_APP="$WORK_DIR/Pine.app"
APPLE_SCRIPT="$WORK_DIR/install.applescript"
INSTALL_SCRIPT="$WORK_DIR/install.sh"

cleanup() {
  /usr/bin/hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true
  /bin/rm -rf "$WORK_DIR"
  /bin/rm -f "$DMG_PATH"
  /bin/rm -f "$HELPER_PATH"
}
trap cleanup EXIT

/bin/mkdir "$MOUNT_POINT"
/usr/bin/hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT" -quiet
if [ ! -d "$MOUNT_POINT/Pine.app" ]; then
  exit 1
fi
/usr/bin/ditto "$MOUNT_POINT/Pine.app" "$STAGED_APP"
/usr/bin/hdiutil detach "$MOUNT_POINT" -quiet

while /bin/kill -0 "$PARENT_PID" >/dev/null 2>&1; do
  /bin/sleep 1
done

/bin/cat > "$INSTALL_SCRIPT" <<'INSTALLSCRIPT'
#!/bin/sh
set -eu
SOURCE_APP="$1"
TARGET_APP="$2"
BACKUP_APP="/Applications/.Pine.update-backup.app"
if [ "$TARGET_APP" != "/Applications/Pine.app" ] || [ ! -d "$SOURCE_APP" ]; then
  exit 1
fi
/bin/rm -rf "$BACKUP_APP"
/bin/mv "$TARGET_APP" "$BACKUP_APP"
if /usr/bin/ditto "$SOURCE_APP" "$TARGET_APP"; then
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true
  /bin/rm -rf "$BACKUP_APP"
else
  /bin/rm -rf "$TARGET_APP"
  /bin/mv "$BACKUP_APP" "$TARGET_APP"
  exit 1
fi
INSTALLSCRIPT
/bin/chmod 700 "$INSTALL_SCRIPT"

/bin/cat > "$APPLE_SCRIPT" <<'APPLESCRIPT'
on run argv
  set installScript to item 1 of argv
  set sourceApp to item 2 of argv
  set targetApp to item 3 of argv
  set installCommand to "/bin/sh " & quoted form of installScript & " " & quoted form of sourceApp & " " & quoted form of targetApp
  do shell script installCommand with administrator privileges
  do shell script "/usr/bin/open " & quoted form of targetApp
end run
APPLESCRIPT

/usr/bin/osascript "$APPLE_SCRIPT" "$INSTALL_SCRIPT" "$STAGED_APP" "$TARGET_APP"
`;

export class AppUpdater {
  private readonly fetchImpl: typeof fetch;
  private downloadedPath: string | null = null;
  private update: UpdateManifest | null = null;
  private windowsUpdateReady = false;

  constructor(private readonly options: AppUpdaterOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async check(): Promise<UpdateCheckResult> {
    if (!["darwin", "win32"].includes(this.options.platform)) {
      return { status: "unsupported" };
    }
    if (!this.options.manifestUrl) return { status: "unconfigured" };

    const checkUrl = new URL(this.options.manifestUrl);
    checkUrl.searchParams.set("check", String(Date.now()));
    const response = await this.fetchImpl(checkUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Update check failed with HTTP ${response.status}`);
    }
    const manifest = parseUpdateManifest(
      await response.json(),
      this.options.manifestUrl,
    );
    if (compareVersions(manifest.version, this.options.currentVersion) <= 0) {
      this.update = null;
      return { status: "current" };
    }
    const assetKey = `${this.options.platform}-${this.options.arch}`;
    if (!manifest.assets[assetKey]) {
      throw new Error(`No installer is available for ${assetKey}`);
    }
    if (this.update?.version !== manifest.version) {
      this.downloadedPath = null;
      this.windowsUpdateReady = false;
    }
    this.update = manifest;
    const releases = releasesForUpdate(manifest, this.options.currentVersion);
    return {
      status: "available",
      update: {
        changelog: manifest.changelog,
        ...(manifest.changelogs ? { changelogs: manifest.changelogs } : {}),
        internalVersion: manifest.internalVersion,
        publishedAt: manifest.publishedAt,
        ...(releases ? { releases } : {}),
        version: manifest.version,
      },
    };
  }

  async download(): Promise<DownloadUpdateResult> {
    if (!this.update) throw new Error("No update is available");
    const asset =
      this.update.assets[`${this.options.platform}-${this.options.arch}`];
    if (!asset) throw new Error("No compatible installer is available");

    if (this.options.platform === "win32") {
      return await this.downloadWindowsUpdate();
    }

    await mkdir(this.options.tempDirectory, { recursive: true });
    const destination = path.join(
      this.options.tempDirectory,
      `pine-${this.update.version}-${asset.sha256.slice(0, 12)}.dmg`,
    );
    const response = await this.fetchImpl(asset.url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Update download failed with HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > 0 &&
      contentLength !== asset.size
    ) {
      throw new Error("Update download size does not match the manifest");
    }

    const file = await open(destination, "w", 0o600);
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let transferredBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        transferredBytes += value.byteLength;
        if (transferredBytes > asset.size) {
          throw new Error("Update download exceeds the manifest size");
        }
        hash.update(value);
        await file.write(value);
        this.options.emit({
          percent: Math.min(100, (transferredBytes / asset.size) * 100),
          totalBytes: asset.size,
          transferredBytes,
          type: "download-progress",
        });
      }
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    } finally {
      await file.close();
    }

    if (
      transferredBytes !== asset.size ||
      hash.digest("hex") !== asset.sha256
    ) {
      await unlink(destination).catch(() => undefined);
      throw new Error("Downloaded update failed its integrity check");
    }
    this.downloadedPath = destination;
    this.options.emit({ type: "download-ready" });
    return { ready: true };
  }

  async install(): Promise<InstallUpdateResult> {
    if (this.options.platform === "win32") {
      if (!this.windowsUpdateReady || !this.options.windowsUpdater) {
        throw new Error("No downloaded Windows update is ready");
      }
      this.options.windowsUpdater.quitAndInstall();
      return { started: true };
    }
    if (this.options.platform !== "darwin" || !this.downloadedPath) {
      throw new Error("No downloaded macOS update is ready");
    }
    const installedPath = resolveCurrentAppPath(this.options.currentExecutable);
    if (
      installedPath === null ||
      path.resolve(installedPath) !== "/Applications/Pine.app"
    ) {
      throw new Error(
        "Move Pine.app to /Applications before installing updates",
      );
    }

    const helperPath = path.join(
      this.options.tempDirectory,
      `pine-update-helper-${process.pid}.sh`,
    );
    await writeFile(helperPath, INSTALL_HELPER, { mode: 0o700 });
    await chmod(helperPath, 0o700);
    const child = spawn(
      "/bin/sh",
      [helperPath, this.downloadedPath, String(process.pid)],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    setTimeout(this.options.quit, 250);
    return { started: true };
  }

  private async downloadWindowsUpdate(): Promise<DownloadUpdateResult> {
    const updater = this.options.windowsUpdater;
    if (!updater || !this.options.manifestUrl) {
      throw new Error("Windows updates are not configured");
    }
    const manifestUrl = this.options.manifestUrl;

    return await new Promise<DownloadUpdateResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Windows update download timed out"));
      }, 30 * 60_000);
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onUnavailable = (): void => {
        cleanup();
        reject(new Error("The Windows update feed has no compatible release"));
      };
      const onDownloaded = (): void => {
        cleanup();
        this.windowsUpdateReady = true;
        this.options.emit({ type: "download-ready" });
        resolve({ ready: true });
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        updater.removeListener("error", onError);
        updater.removeListener("update-not-available", onUnavailable);
        updater.removeListener("update-downloaded", onDownloaded);
      };

      updater.on("error", onError);
      updater.once("update-not-available", onUnavailable);
      updater.once("update-downloaded", onDownloaded);
      updater.setFeedURL({
        url: resolveWindowsFeedUrl(manifestUrl, this.options.arch),
      });
      updater.checkForUpdates();
    });
  }
}
