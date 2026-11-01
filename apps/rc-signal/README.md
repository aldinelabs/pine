# @pine/rc-signal

Signaling for Pine's Remote Control. It relays the signed offer and answer
between a desktop and a phone, and hands out short-lived Cloudflare TURN
credentials once both are connected. It never reads, stores or verifies what
it relays: the devices authenticate each other with `@pine/rc-protocol`.

No runtime dependencies. Run it on Node 20 or newer.

## API

All paths sit under `/rc/v1`. A room id is 43 base64url characters derived from
a secret that only the two devices know, so it works as a capability.

| Request                            | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `GET /health`                      | Liveness.                                            |
| `GET /rooms/:room/events?role=`    | Server-sent events of what the peer sends.           |
| `POST /rooms/:room/messages?role=` | Send a JSON object to the peer, held up to a minute. |
| `POST /rooms/:room/turn?role=`     | TURN credentials, only while both roles are online.  |

`role` is `host` for the desktop and `client` for the phone.

## Configuration

See `deploy/rc-signal.env.example`. `RC_SIGNAL_ORIGINS` is required and must
list exact page origins; there is no wildcard. TURN credentials are limited
per address, per room and per UTC day.

## Deploy

```sh
bun run --filter @pine/rc-signal build
scp apps/rc-signal/dist/rc-signal.mjs <host>:~/rc-signal/
```

With root, install `deploy/rc-signal.service` and create `/etc/rc-signal.env`
from the example (root-owned, mode 0600), then `systemctl enable --now
rc-signal`. Without root, use `deploy/rc-signal.user.service` as
`~/.config/systemd/user/rc-signal.service`, keep the env file at
`~/rc-signal/rc-signal.env` (mode 0600) and run `systemctl --user enable --now
rc-signal`; enable lingering so it survives logout.
Route `/rc/` of your public host to `http://127.0.0.1:8787`, and list that
route before any catch-all route for the same host.
