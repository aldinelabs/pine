# Pi Extension Boundary

## Context

Pine embeds `@earendil-works/pi-agent-core` and supplies its own Electron host and Vue UI. The embedded Pi packages are pinned to the released `0.85.1` (`pi-agent-core`, `pi-ai`, `pi-coding-agent`) and never replaced by source builds; only `pi-ai`'s generated model catalogs can be refreshed ahead of a release: see [Pi Model Backport](./pi-model-backport.md).

Before implementing behavior related to Pi, first check whether it belongs in a reusable Pi extension. Prefer an extension when the behavior is useful inside Pi itself and can be expressed through its public extension lifecycle without replacing host UI.

## Session search decision

Pi extensions can:

- register an alternative command such as `/pine-resume`;
- list sessions with `SessionManager.list()`;
- switch through the supported `ctx.switchSession()` command API;
- observe or cancel `session_before_switch` and rebuild state during `session_start`.

Pi extensions cannot non-invasively replace the built-in `/resume` selector. In the embedded Pi 0.85.1, interactive mode handles the exact `/resume` input before extension command dispatch. A same-name extension command is reported as a built-in conflict and omitted from autocomplete. The `session_before_switch` event runs only after the built-in selector has already chosen a target.

Pine therefore owns its Electron Session Search Overlay and session switching at the host boundary. It keeps Pi JSONL sessions as the source of truth and uses `JsonlSessionRepo` rather than introducing a second session format.

Opening a workspace initializes the session repository and search index without creating a Pi session. The runtime keeps a nullable active-session slot and creates a persistent session atomically when the first message needs one. Resuming an existing session fills the same slot without creating an empty session first.

Empty Pi sessions are excluded from the derived search index and deleted through `JsonlSessionRepo`. Sessions created or resumed by the current runtime are protected from cleanup while live, preventing a concurrent history refresh from racing the first message write. An abandoned empty session is removed the next time the workspace is opened and its history is refreshed.

### Legacy session compatibility and healing

The published Pi 0.87.1 packages use two session representations: the coding agent writes v3 JSONL, while `JsonlSessionRepo` imports v3 records into a logical v4 view. Its legacy reader does not recognize `context_edit`, although the coding agent writes and applies it.

`PineSessionFileSystem` normalizes unsupported, structurally valid v3 records into opaque custom metadata during streaming reads. It preserves their IDs, parent links, timestamps, and full payloads across the importer's repeated scans. This automatically restores access to previously unreadable conversations without rewriting their files or modifying installed Pi packages. History and exports retain original messages; the agent reads the original v3 file and still applies context omissions and replacements. Native v4 records, malformed records, and torn trailing lines are left to upstream validation.

Renaming a closed v3 conversation appends a v3 `session_info` record through `SessionManager`; a core `Session.setName` commit would upgrade the source to v4, which the coding agent cannot resume. Any cached core read handle is closed first. Native v4 sessions continue to use the core repository.

Index refresh isolates failures while reading individual session documents. It leaves unreadable files intact, retains any last successful index row, logs the failing path, and retries on subsequent refreshes. Only successfully read sessions can be classified as empty and removed. This recovery covers unsupported legacy metadata; it does not invent missing messages or silently discard malformed JSON or broken entry references.

The SQLite FTS5 database under `.pine/cache/` is a derived, disposable index. It uses the trigram tokenizer for Latin and CJK substring search, stores source modification times for incremental refresh, and can be rebuilt entirely from Pi JSONL files.

If CLI integration is needed later, extract the search engine behind a shared package and add a thin `/pine-resume` Pi extension adapter. Do not patch or shadow the built-in `/resume` command.

## Media generation decision

Image generation is a Pine-native tool pair: `activate_media_generation` is always visible, and activating it exposes `generate_image` for the rest of the session. Activation is recorded as a session entry so resumed sessions keep the tool, and the tool set is recomputed through the same `toolNamesFor*State` narrowing as Computer Use and Skill authoring. The indirection exists because more media tools are expected later; each new one joins `MEDIA_GENERATION_DYNAMIC_TOOL_NAMES` instead of widening the always-visible tool set.

Generation itself uses pi-ai's image surface (`ImagesModels`) rather than the chat/stream APIs, with OpenRouter as the aggregating provider. The OpenRouter credential comes from the same `auth.json` that authenticates chat models, so no separate key is stored. The selected image model is a Pine setting (`pine-settings.json`) chosen in the settings dialog's Harness section, where the shared model picker lists pi-ai's image catalog instead of Pine's chat models. That setting is also the only way to choose an image model: the tools take no model argument, so a call always runs on the user's selection, falling back to Pine's default when the user never picked one.

That catalog is a generated snapshot inside `pi-ai`, so image models reach Pine when `pi-ai` commits them upstream, not when OpenRouter adds them. [Pi Model Backport](./pi-model-backport.md) closes most of that gap, and the desktop build now runs it before packaging so installers carry the same catalogs local development sees.

### Two OpenRouter transports

OpenRouter serves image models on two endpoints, and pi-ai 0.85.1 only implements the first:

| Transport           | Endpoint                                                     | Models                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat                | `POST /api/v1/chat/completions` with `modalities: ["image"]` | Models whose catalog `output` includes `text`, so the answer can carry prose next to the image (`google/gemini-3-pro-image`, `openai/gpt-5-image`, `openrouter/auto`) |
| Dedicated image API | `POST /api/v1/images`                                        | Pure image models, which OpenRouter rejects on the chat endpoint (`openai/gpt-image-*`, `black-forest-labs/flux.*`, `recraft/*`, `bytedance-seed/seedream-*`, …)      |

Pine classifies with the catalog's declared modalities (`imageTransportFor` in `apps/desktop/src/agent/media/tools.ts`), so a pure image model never pays for a doomed chat round trip. A model that OpenRouter reclassifies later is still handled: when the chat transport answers with the `cannot be used with the chat/completions endpoint … Use the /api/v1/images endpoint instead` error, the call is retried once on the dedicated API.

`generateImagesViaEndpoint` in `apps/desktop/src/agent/media/openrouter-images-endpoint.ts` speaks the documented image API and returns pi-ai's `AssistantImages` shape, so activation, approval, file writing, and result formatting stay transport-agnostic. Model options from the tool's `parameters` argument pass through unchanged, while `model`, `prompt`, `messages`, and `stream` stay under Pine's control.

The tool accepts OpenRouter-style `input_references` as well as Pine's shorter string form. Each reference may be a path from the current `<pine_attachments>` block, an HTTP(S) URL, or a base64 data URL. Pine resolves local files through the existing folder policy and normalizes every reference to pi-ai image content; the chat transport sends mixed text/image content, while the dedicated endpoint emits `input_references` with data URLs. Multiple references retain their input order, and models whose catalog does not include `image` input are rejected before the provider call.

This shim exists only because the released pi-ai has not caught up. If a future pi-ai release implements the image API — or `pi` itself starts marking the transport per model — delete the shim and route through `ImagesModels` again.

Image generation leaves the project sandbox, so calls pass through the approval gate like other privileged actions, and generated files are written into the project's temporary directory unless the model names a path inside a folder shared with Pine.

Pine never opens a generated image on the model's behalf. The temporary directory sits outside the folders the user shares with Pine, so a preview of it would only ever be a path the user cannot find again, and an automatic tab steals attention for an image the user may not have asked to see yet. Showing an image is therefore an explicit second step: the model writes or copies the file into a folder shared with Pine and calls `ui_present_file` on that path.
