# @pine/rc-web

The page other devices open for Pine's Remote Control, served at
`https://rc.aldine.cn`. It pairs by QR code or link, keeps the device's key and the
paired computers in IndexedDB, and opens one WebRTC DataChannel to the
desktop. A service worker sends every request from the embedded
`/pine/<token>/` page through that channel to the desktop's local web
server, so the device runs the desktop's own web interface, whatever version
it is.

It is a static site with no server code. The signaling service it talks to is
`apps/rc-signal`; the protocol is `packages/rc-protocol`.

## Develop

```sh
bun run --filter @pine/rc-web build
bun run --filter @pine/rc-web preview   # http://localhost:5180
```

Use the preview, not `vite` dev: Chromium does not register the development
service worker reliably. To pair a local desktop with the local page, run a
signaling service that allows `http://localhost:5180` and start Pine with:

```sh
PINE_RC_PAGE_ORIGIN=http://localhost:5180 \
PINE_RC_SIGNALING=http://localhost:8788 bun run dev
```

## Interface

The page uses Vue with shadcn-vue in the same style and olive palette as the
desktop app (`components.json`), so it looks like the Pine it embeds. Add
components from this directory with `bun run --bun shadcn-vue add <name>`, and
keep `src/components/ui/` as the CLI generates it. Text lives in
`src/i18n/locales/`; the page follows the language chosen inside the embedded
Pine, which shares its origin, and otherwise the browser's.

## Deploy to EdgeOne Pages

EdgeOne builds the site from `main` on every push:

| Setting          | Value                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| Root directory   | `apps/rc-web`                                                                     |
| Install command  | `npm install -g bun@1.3.4 && bun install --frozen-lockfile --filter @pine/rc-web` |
| Build command    | `bun run build`                                                                   |
| Output directory | `dist`                                                                            |

`dist/edgeone.json` sets the response headers. The custom domain
`rc.aldine.cn` needs HTTPS: service workers, WebRTC and Web Crypto refuse
plain HTTP.

The signaling service must list the page origin in `RC_SIGNAL_ORIGINS`.

Deploy only what this repository builds. Whoever can change this site can
serve code that uses a paired device's key, so protect the EdgeOne account and
the DNS for `aldine.cn` with two-factor sign-in.

## Policies the site depends on

- The embedded Pine inherits this site's Content Security Policy, because its
  responses are made by the service worker. The policy therefore only sets
  `frame-ancestors`, `object-src` and `base-uri`; Pine's own page brings its
  own policy.
- Pine answers `X-Frame-Options: DENY`; the worker rewrites it to
  `SAMEORIGIN` so this site's page can embed it and other sites still cannot.
- Changing the domain loses every paired device: keys live in the origin's
  storage.
