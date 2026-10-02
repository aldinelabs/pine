# @pine/pi-background-tasks

Pine's host-neutral port of the background shell task tools from
[`pi-background-tasks`](https://github.com/ismailsaleekh/pi-background-tasks)
2.6.9 (`4aceb55`), used under the ISC license in `LICENSE.upstream`.

The tool names `bg_run`, `bg_status`, `bg_logs`, and `bg_kill`, the task status
values, the `<background-task-notification>` message, and its
`background-task-notification` custom message type are kept verbatim, so the
model sees the same contract as the upstream extension.

The package root holds the protocol, prompt text, and formatting, and is safe
to import from the renderer. `@pine/pi-background-tasks/registry` holds the
Node-only task registry. It runs commands through an injected executor, so the
host decides how a command is sandboxed and approved.

Pine keeps only the ordinary shell task surface. It does not port the upstream
Fusion workflows, `bg_delegate`, `bg_run_pi_attested`, or the Anthropic
attribution provider, which launch child `pi` CLI processes or rewrite provider
traffic. Pine also drops the upstream reload survival, EventBus API, durable
metadata files, `isAgent` telemetry wrapper, terminal dock, and slash commands;
the desktop app supplies its own panel, transcript markers, and localization.
LLM-facing strings stay English, as upstream.
