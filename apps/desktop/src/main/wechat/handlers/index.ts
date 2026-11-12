// Every command handler, merged into the registry the inbound pipeline uses.
import { askHandlers } from "./asks";
import { automationHandlers } from "./automations";
import { catalogHandlers } from "./catalog";
import { controlHandlers } from "./controls";
import { fileHandlers } from "./files";
import { handleNumber, handlePlainMessage } from "./message";
import { metaHandlers } from "./meta";
import { projectHandlers } from "./projects";
import { sessionHandlers } from "./sessions";
import { taskHandlers } from "./tasks";
import type { HandlerRegistry } from "./types";

export const HANDLERS: HandlerRegistry = {
  commands: {
    ...metaHandlers,
    ...sessionHandlers,
    ...projectHandlers,
    ...askHandlers,
    ...controlHandlers,
    ...fileHandlers,
    ...taskHandlers,
    ...automationHandlers,
    ...catalogHandlers,
  },
  message: handlePlainMessage,
  number: handleNumber,
};
