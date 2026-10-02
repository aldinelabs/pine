# @pine/rpiv-todo

Pine's host-neutral port of the `todo` tool. Its parameter schema, status
machine, dependency validation, response envelope, branch replay, and overlay
layout rules are adapted from
[`@juicesharp/rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo)
2.12.0 (`68d9a00`), used under the MIT license in `LICENSE.upstream`.

The tool name `todo` and the `details` snapshot shape are kept verbatim, so
sessions written by the upstream extension replay in Pine and vice versa.

The upstream package owns a Pi terminal overlay, a `/todos` command, a collapse
shortcut, and an optional config file. Pine keeps the protocol and state rules
in this workspace package and supplies its own Electron/Vue panel, transcript
markers, and localization. LLM-facing strings stay English, as upstream.
