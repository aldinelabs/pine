import type { PineAgentEvent } from "../../shared/agent";
import type { PineLibraryChange } from "../../shared/projects";
import type { AgentProcessFactory } from "../agentProcessHost";
import type { ProjectFileNativeActions } from "../projectFileOperations";
import type { TinyFishSafeStorage } from "../tinyfishCredentials";

/**
 * What Pine needs from the place it runs: the Electron app or the headless
 * server. Everything here is a platform capability; the application itself
 * lives in PineCore and never imports Electron.
 */
export interface PineHost {
  /** Holds settings, projects and credentials (Electron's userData). */
  dataDirectory: string;
  logsDirectory: string;
  /** The approximate-location database shipped with Pine. */
  geoipDatabasePath: string;
  version: string;
  /** Runtime details recorded with diagnostics, such as the Electron version. */
  runtime: Record<string, string>;
  /** Outgoing requests Pine makes itself; the desktop follows the system proxy. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  createAgentProcess: AgentProcessFactory;
  credentialStorage: TinyFishSafeStorage;
  /** The built renderer the browser interface serves, or a dev server. */
  renderer: { root: string; devUrl?: string };
  fileActions: ProjectFileNativeActions;
  /** Delivers an event to a desktop window; false once it is gone. */
  sendToClient(clientId: number, channel: string, value: unknown): boolean;
  /** Brings a desktop window to the front; false when there is none. */
  focusClient(clientId: number): boolean;
  /** Tells desktop windows other than the source that the library changed. */
  libraryChanged(change: PineLibraryChange, sourceClientId?: number): void;
  /**
   * Sees each session event before Pine routes it, to tell the user about
   * it. The owner is undefined once no interface holds the session.
   */
  observeAgentEvent?(event: PineAgentEvent, ownerId: number | undefined): void;
  attentionNotificationsChanged?(enabled: boolean): void;
}
