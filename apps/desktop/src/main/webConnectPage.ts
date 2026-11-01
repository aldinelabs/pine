import { randomBytes } from "node:crypto";

/** Copy for each sign-in state, kept beside the page so it ships without the renderer bundle. */
const COPY = {
  en: {
    connecting: ["Signing in…", "Connecting this browser to Pine."],
    missing: [
      "Open Pine from its link",
      "In Pine, go to Settings → Remote control and choose Open in browser or Copy link.",
    ],
    failed: [
      "This link no longer works",
      "Pine may have restarted or changed its port. Open a fresh link from Settings → Remote control.",
    ],
    retry: "Try again",
  },
  zh: {
    connecting: ["正在登录…", "正在将此浏览器连接到 Pine。"],
    missing: [
      "请通过 Pine 提供的链接打开",
      "在 Pine 中前往 设置 → 远程控制，选择「在浏览器中打开」或「复制链接」。",
    ],
    failed: [
      "此链接已失效",
      "Pine 可能已重启或更换了端口。请从 设置 → 远程控制 重新获取链接。",
    ],
    retry: "重试",
  },
} as const;

const STYLE = `
:root{color-scheme:light dark;--bg:oklch(0.985 0.002 106.5);--card:oklch(1 0 0);--fg:oklch(0.153 0.006 107.1);--muted:oklch(0.58 0.031 107.3);--border:oklch(0.93 0.007 106.5);--primary:oklch(0.228 0.013 107.4);--primary-fg:oklch(0.988 0.003 106.5);--danger:oklch(0.577 0.245 27.325)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(0.153 0.006 107.1);--card:oklch(0.195 0.01 107.2);--fg:oklch(0.988 0.003 106.5);--muted:oklch(0.737 0.021 106.9);--border:oklch(1 0 0 / 10%);--primary:oklch(0.93 0.007 106.5);--primary-fg:oklch(0.228 0.013 107.4);--danger:oklch(0.704 0.191 22.216)}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:400px;padding:32px;border:1px solid var(--border);border-radius:16px;background:var(--card);box-shadow:0 1px 2px oklch(0 0 0 / 4%),0 8px 24px oklch(0 0 0 / 6%)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px;font-weight:600;letter-spacing:-0.01em}
.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--primary);color:var(--primary-fg)}
.mark svg{width:16px;height:16px}
.state{display:flex;gap:14px;align-items:flex-start}
.icon{flex:none;display:grid;place-items:center;width:20px;height:24px;color:var(--muted)}
.icon svg{width:18px;height:18px}
[data-state=failed] .icon{color:var(--danger)}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--fg);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:2.4s}}
h1{margin:0;font-size:16px;font-weight:600;line-height:24px}
p{margin:4px 0 0;color:var(--muted);font-size:14px}
button{margin-top:24px;width:100%;height:36px;border:0;border-radius:8px;background:var(--primary);color:var(--primary-fg);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
[hidden]{display:none!important}
`;

const PINE_MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/></svg>`;
const ICONS = {
  connecting: `<span class="spinner" aria-hidden="true"></span>`,
  missing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`,
  failed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
};

/**
 * Sign-in page for browsers without a session. The access token stays in the
 * URL fragment, is removed from history and is exchanged for an HttpOnly cookie.
 */
export function webConnectPage(): Response {
  const nonce = randomBytes(16).toString("base64");
  const script = `
const copy = ${JSON.stringify(COPY)};
const icons = ${JSON.stringify(ICONS)};
const text = navigator.language.toLowerCase().startsWith("zh") ? copy.zh : copy.en;
document.documentElement.lang = text === copy.zh ? "zh-CN" : "en";
const root = document.querySelector("main");
const retry = document.getElementById("retry");
retry.textContent = text.retry;
function show(state) {
  root.dataset.state = state;
  document.getElementById("icon").innerHTML = icons[state];
  document.getElementById("title").textContent = text[state][0];
  document.getElementById("detail").textContent = text[state][1];
  document.title = text[state][0] + " · Pine";
}
const token = new URLSearchParams(location.hash.slice(1)).get("access_token");
async function connect() {
  retry.hidden = true;
  show("connecting");
  try {
    const response = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) return location.replace("/");
    show("failed");
    // A rejected token will not succeed on retry; a network error might.
    retry.hidden = response.status === 401 || response.status === 403;
  } catch {
    show("failed");
    retry.hidden = false;
  }
}
if (token) {
  history.replaceState(null, "", "/");
  retry.addEventListener("click", connect);
  connect();
} else show("missing");
`;
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Pine</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main data-state="connecting" aria-live="polite">
  <div class="brand"><span class="mark">${PINE_MARK}</span>Pine</div>
  <div class="state">
    <span class="icon" id="icon">${ICONS.connecting}</span>
    <div><h1 id="title"></h1><p id="detail"></p></div>
  </div>
  <button type="button" id="retry" hidden></button>
</main>
<script nonce="${nonce}">${script}</script>
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}
