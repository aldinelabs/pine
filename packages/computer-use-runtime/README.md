# @pine/computer-use-runtime

Native Computer Use sidecar and Chrome extension used by Pine. The native code
is vendored from Munim Computer Use v0.14.1 and built locally; Pine never invokes
the upstream npm launcher's runtime download path.

Run `bun run build` to create the platform-specific `pine-computer-use/`
bundle consumed by Electron Forge. The bundle contains the native executable,
the Pine-branded unpacked Chrome extension, and the upstream license/notice.

See `NOTICE.md`, `LICENSE.upstream`, and `README.upstream.md` for attribution and
upstream documentation.

Pine's identity for the native runtime (support directory name, native host,
extension id, agent cursor) lives in `pine-identity.json`. After updating the
vendored source, rebuild and run `bun run sync:tool-specs` to refresh
`tool-specs.json`.
