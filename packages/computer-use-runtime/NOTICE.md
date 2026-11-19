# Pine Computer Use third-party notice

Pine Computer Use includes a modified copy of
[`munim-computer-use`](https://github.com/munimtechnologies/munim-computer-use)
version 0.14.1, commit `e9304ae` (tag `v0.14.1`).

Copyright 2026 Munim, Inc. The upstream work is licensed under the Apache
License 2.0; see `LICENSE.upstream`.

Pine runs the server under its own identity through the upstream embedder
profile (`pine-identity.json`, passed with `--profile`): Pine's support
directory, browser bridge socket, agent-cursor overlay app and bundle id,
native-messaging host name and browser extension id, so a standalone Munim
install on the same machine is never shared. The browser extension is built
with upstream's `scripts/build-extension.mjs` under Pine's name, tab-group
title and stable extension key.

Pine's source modifications are limited to branding:

- the Chrome extension uses Pine artwork;
- the agent pointer keeps Munim's geometry and motion but uses Pine's warm
  olive palette across native overlays and the browser page overlay (whose
  element id is Pine's own);
- error messages the agent reads name the Pine Computer Use extension and
  point to Pine's `install_pine_browser_extension` tool;
- build and packaging scripts place the native server and extension inside the
  Pine application instead of downloading a release binary at runtime.

The vendored source remains under `vendor/munim-computer-use/`. The surrounding
Pine integration is licensed under Pine's project license.
