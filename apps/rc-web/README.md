# @pine/rc-web

The page phones open for Pine's Remote Control, served at
`https://rc.aldine.cn`. It pairs by QR code, keeps the phone's key and the
paired computers in IndexedDB, and opens one WebRTC DataChannel to the
desktop. A service worker sends every request from the embedded
`/pine/<token>/` page through that channel to the desktop's local web
server, so the phone runs the desktop's own web interface, whatever version
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

## Deploy to EdgeOne Pages

Build locally and upload `dist/` as a direct-upload project. `dist/edgeone.json`
sets the response headers.

1. `bun run build:rc-web` from the repository root.
2. In EdgeOne Pages, create a project with **direct upload** and upload
   `apps/rc-web/dist`, or run `edgeone pages deploy apps/rc-web/dist`.
3. Add the custom domain `rc.aldine.cn` and turn on HTTPS. The page needs
   HTTPS: service workers, WebRTC and Web Crypto refuse plain HTTP.
4. The signaling service must list the page origin in `RC_SIGNAL_ORIGINS`.

Deploy only what this repository builds. Whoever can change this site can
serve code that uses a paired phone's key, so protect the EdgeOne account and
the DNS for `aldine.cn` with two-factor sign-in.

## Policies the site depends on

- The embedded Pine inherits this site's Content Security Policy, because its
  responses are made by the service worker. The policy therefore only sets
  `frame-ancestors`, `object-src` and `base-uri`; Pine's own page brings its
  own policy.
- Pine answers `X-Frame-Options: DENY`; the worker rewrites it to
  `SAMEORIGIN` so this site's page can embed it and other sites still cannot.
- Changing the domain loses every paired phone: keys live in the origin's
  storage.
