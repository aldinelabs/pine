import type {
  AgentWorkerInbound,
  AgentWorkerMessage,
  AgentWorkerRequest,
  AgentWorkerResult,
} from "./agent/protocol";
import { toErrorMessage } from "./agent/protocol";
import { PineAgentRuntime } from "./agent/runtime";

const parentPort = process.parentPort;
if (!parentPort)
  throw new Error("Pine agent must run as an Electron utility process.");

const runtime = new PineAgentRuntime({
  emit: (event) => parentPort.postMessage({ type: "event", event }),
});

async function handleRequest(request: AgentWorkerRequest): Promise<void> {
  let result: AgentWorkerResult;
  switch (request.type) {
    case "session:create":
      result = await runtime.createSession(request.location);
      break;
    case "session:open":
      result = await runtime.openSession(request.location, request.sessionFile);
      break;
    case "session:prompt":
      result = await runtime.prompt(
        request.sessionId,
        request.message,
        request.streamingBehavior,
        request.attachedPaths,
        request.approvalMode,
        request.locale,
        request.rewrite,
      );
      break;
    case "session:abort":
      result = await runtime.abort(request.sessionId);
      break;
    case "session:compact":
      result = await runtime.compact(request.sessionId);
      break;
    case "session:dequeue-steering":
      result = await runtime.dequeueSteering(
        request.sessionId,
        request.message,
      );
      break;
    case "session:set-approval-mode":
      result = runtime.setSessionApprovalMode(
        request.sessionId,
        request.approvalMode,
      );
      break;
    case "session:rename":
      result = runtime.renameSession(request.sessionId, request.name);
      break;
    case "session:dispose":
      result = await runtime.disposeSession(request.sessionId);
      break;
    case "mcp:reload":
      result = await runtime.reloadMcp(request.sessionId);
      break;
    case "mcp:status":
      result = runtime.getMcpStatus(request.sessionId);
      break;
    case "background:list":
      result = runtime.listBackgroundTasks(request.sessionId);
      break;
    case "background:stop":
      result = await runtime.stopBackgroundTask(
        request.sessionId,
        request.taskId,
      );
      break;
    case "background:stop-all":
      result = await runtime.stopAllBackgroundTasks(request.sessionId);
      break;
    case "background:rerun":
      result = await runtime.rerunBackgroundTask(
        request.sessionId,
        request.taskId,
      );
      break;
    case "background:output":
      result = await runtime.readBackgroundTaskOutput(
        request.sessionId,
        request.taskId,
        request.maxBytes,
      );
      break;
    case "models:catalog":
      result = await runtime.getModelCatalog(request.agentDir);
      break;
    case "models:refresh-catalog":
      result = await runtime.refreshModelCatalog(request.agentDir);
      break;
    case "models:add-custom":
      result = await runtime.addCustomModel(request.agentDir, request);
      break;
    case "models:update-custom":
      result = await runtime.updateCustomModel(request.agentDir, request);
      break;
    case "models:delete-custom":
      result = await runtime.deleteCustomModel(request.agentDir, request);
      break;
    case "providers:update-custom":
      result = await runtime.updateCustomProvider(request.agentDir, request);
      break;
    case "providers:delete-custom":
      result = await runtime.deleteCustomProvider(request.agentDir, request);
      break;
    case "provider:login":
      result = await runtime.loginProvider(
        request.agentDir,
        request.loginId,
        request.providerId,
        request.authType,
      );
      break;
    case "provider:auth-response":
      result = runtime.respondToProviderAuth(
        request.loginId,
        request.promptId,
        request.value,
      );
      break;
    case "provider:auth-cancel":
      result = runtime.cancelProviderAuth(request.loginId);
      break;
    case "provider:logout":
      result = await runtime.logoutProvider(
        request.agentDir,
        request.providerId,
      );
      break;
    case "models:select":
      result = await runtime.selectModel(
        request.agentDir,
        request.providerId,
        request.modelId,
        request.thinkingLevel,
        request.sessionId,
      );
      break;
    case "models:select-utility":
      result = await runtime.selectUtilityModel(
        request.agentDir,
        request.selection,
      );
      break;
    case "models:select-image":
      result = await runtime.selectImageModel(
        request.agentDir,
        request.selection,
      );
      break;
    case "runtime:dispose":
      result = await runtime.dispose();
      break;
    case "runtime:set-tinyfish-api-key":
      result = runtime.setTinyFishApiKey(request.tinyFishApiKey);
      break;
    case "runtime:set-context-compaction-strategy":
      result = runtime.setContextCompactionStrategy(request.strategy);
      break;
  }

  parentPort.postMessage({
    type: "response",
    id: request.id,
    ok: true,
    result,
  } satisfies AgentWorkerMessage);
}

parentPort.on("message", (event) => {
  const inbound = event.data as AgentWorkerInbound;
  // Approval decisions from the renderer ride a dedicated inbound message;
  // they resolve pending gate promises instead of being handled as requests.
  if (inbound.type === "approval:response") {
    runtime.resolveApproval(inbound.requestId, inbound.decision);
    return;
  }
  if (inbound.type === "questionnaire:response") {
    runtime.resolveQuestionnaire(inbound.requestId, inbound.submission);
    return;
  }
  const request = inbound;
  void handleRequest(request).catch((error: unknown) => {
    parentPort.postMessage({
      type: "response",
      id: request.id,
      ok: false,
      error: { message: toErrorMessage(error) },
    } satisfies AgentWorkerMessage);
  });
});

parentPort.postMessage({ type: "ready" } satisfies AgentWorkerMessage);
