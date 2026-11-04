import { vi } from "vitest";
import type { AgentHost } from "../agentProcessHost";
import type { PineSessionSummary } from "../../shared/sessions";

export function createAgentHost(sessionSummary: PineSessionSummary): AgentHost {
  return {
    abort: vi.fn().mockResolvedValue({ aborted: false }),
    compact: vi.fn().mockResolvedValue({ compacted: true }),
    dequeueSteering: vi.fn().mockResolvedValue({ removed: false }),
    sendSteeringNow: vi.fn().mockResolvedValue({ sent: false }),
    createSession: vi.fn().mockResolvedValue({ session: sessionSummary }),
    disposeSession: vi.fn().mockResolvedValue({ disposed: true }),
    addCustomModel: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    updateCustomModel: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    deleteCustomModel: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    updateCustomProvider: vi
      .fn()
      .mockResolvedValue({ models: [], providers: [] }),
    deleteCustomProvider: vi
      .fn()
      .mockResolvedValue({ models: [], providers: [] }),
    getModelCatalog: vi.fn().mockResolvedValue({ models: [], providers: [] }),
    refreshModelCatalog: vi
      .fn()
      .mockResolvedValue({ models: [], providers: [] }),
    loginProvider: vi.fn().mockResolvedValue({ credentialType: "api_key" }),
    respondToProviderAuth: vi.fn().mockResolvedValue({ accepted: true }),
    cancelProviderAuth: vi.fn().mockResolvedValue({ cancelled: true }),
    logoutProvider: vi.fn().mockResolvedValue({ disposed: true }),
    selectModel: vi.fn().mockResolvedValue({ disposed: true }),
    selectUtilityModel: vi.fn().mockResolvedValue({ updated: true }),
    selectApprovalModel: vi.fn().mockResolvedValue({ updated: true }),
    selectVideoModel: vi.fn(),
    selectImageModel: vi.fn().mockResolvedValue({ updated: true }),
    setTinyFishApiKey: vi.fn().mockResolvedValue({ updated: true }),
    setContextCompactionStrategy: vi.fn().mockResolvedValue({ updated: true }),
    setContextCompactionRoute: vi.fn().mockResolvedValue({ updated: true }),
    openSession: vi.fn().mockResolvedValue({ session: sessionSummary }),
    prompt: vi.fn().mockResolvedValue({
      accepted: true,
      session: { ...sessionSummary, messageCount: 2 },
    }),
    mutateSession: vi
      .fn()
      .mockImplementation((_sessionId, mutators) =>
        Promise.resolve({ applied: mutators }),
      ),
    renameSession: vi.fn().mockImplementation((sessionId, name) =>
      Promise.resolve({
        session: { ...sessionSummary, id: sessionId, name },
      }),
    ),
    respondApproval: vi.fn(),
    respondQuestionnaire: vi.fn(),
    setApprovalMode: vi.fn().mockResolvedValue({ updated: true }),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };
}
