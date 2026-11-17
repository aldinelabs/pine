# Recommended models

Pine marks some models as recommended in its model pickers. The lists are read
at runtime from the public gist
[`kev1nweng/a9a2fd18d8fb238f4c9ecbe7d6a64643`](https://gist.github.com/kev1nweng/a9a2fd18d8fb238f4c9ecbe7d6a64643),
so they can change without a release. The app code lives in
`apps/desktop/src/main/modelRecommendations.ts`.

## Files in the gist

| File                              | Read by                   | Shape                                |
| --------------------------------- | ------------------------- | ------------------------------------ |
| `pine-recommended-models.json`    | every released version    | JSON array of chat model IDs         |
| `pine-recommended-models.v2.json` | versions with model kinds | `{ version: 2, chat, image, video }` |

Released versions parse `pine-recommended-models.json` as a bare string array
and ignore anything else, so its shape must never change. Model kinds live in a
separate v2 file instead. Keep the `chat` list in both files identical.

Pine reads the v2 file first. If it is missing (HTTP 404), unreachable or not a
version-2 object, Pine uses the legacy file for chat recommendations and keeps
the image and video lists from its last successful v2 load. A future
incompatible shape gets a new file (`…v3.json`), never an edit to an old one.

## v2 schema

```json
{
  "version": 2,
  "chat": ["<chat model ID>"],
  "image": ["<image generation model ID>"],
  "video": ["<video generation model ID>"]
}
```

- `version` must be `2`; otherwise the whole file is ignored.
- Each kind is optional. A kind that is not an array counts as empty. Entries
  that are not non-empty strings (at most 200 characters) are dropped and
  duplicates removed; at most 1,000 IDs per kind are read.
- Unknown keys are ignored, so new kinds can be added without breaking clients.
- IDs are matched exactly against what Pine offers, and recommendations for
  models the user cannot pick are not shown:
  - `chat`: the model ID shown under the model name in the chat model picker
    (for example `glm-5.3-flash`), across all providers.
  - `image`: an OpenRouter image model ID from pi-ai's built-in catalog (for
    example `google/gemini-3-pro-image`).
  - `video`: an ID from OpenRouter's live video catalog
    (`https://openrouter.ai/api/v1/videos/models`).

The pickers list recommended models in their usual catalog order; the WeChat
model list follows the order in the file.

## Publishing

`pine-recommended-models.v2.json` in this folder is the proposed content of the
gist file of the same name. Copy it into the gist by hand; nothing in CI
publishes it.
