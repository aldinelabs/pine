import { randomBytes } from "node:crypto";

/** Copy for the sign-in page, kept beside it so it ships without the renderer bundle. */
const COPY = {
  en: {
    title: "Sign in to Pine",
    detail:
      "Enter the browser access password set in Pine under Settings → Remote control.",
    password: "Password",
    submit: "Continue",
    signingIn: "Signing in…",
    wrong: "That password is incorrect.",
    locked: "Too many attempts. Try again in {seconds} s.",
    failed: "Pine could not be reached. Check that it is still running.",
  },
  zh: {
    title: "登录 Pine",
    detail: "输入在 Pine 设置 → 远程控制 中设置的浏览器访问密码。",
    password: "密码",
    submit: "继续",
    signingIn: "正在登录…",
    wrong: "密码不正确。",
    locked: "尝试次数过多，请在 {seconds} 秒后重试。",
    failed: "无法连接 Pine，请确认它仍在运行。",
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
h1{margin:0;font-size:16px;font-weight:600;line-height:24px}
p{margin:4px 0 0;color:var(--muted);font-size:14px}
form{margin-top:20px}
label{display:block;margin-bottom:6px;font-size:14px;font-weight:500}
input{display:block;width:100%;height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:16px}
input:focus-visible{outline:2px solid var(--fg);outline-offset:1px}
input[aria-invalid=true]{border-color:var(--danger)}
.error{margin-top:8px;color:var(--danger);font-size:14px}
button{margin-top:16px;width:100%;height:36px;border:0;border-radius:8px;background:var(--primary);color:var(--primary-fg);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
[hidden]{display:none!important}
`;

const PINE_MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/></svg>`;
/**
 * Sign-in page for browsers without a session. The password is exchanged for
 * an HttpOnly cookie, after which the page reloads into Pine.
 */
export function webConnectPage(): Response {
  const nonce = randomBytes(16).toString("base64");
  const script = `
const copy = ${JSON.stringify(COPY)};
const text = navigator.language.toLowerCase().startsWith("zh") ? copy.zh : copy.en;
document.documentElement.lang = text === copy.zh ? "zh-CN" : "en";
document.title = text.title + " · Pine";
document.getElementById("title").textContent = text.title;
document.getElementById("detail").textContent = text.detail;
document.getElementById("label").textContent = text.password;
const form = document.querySelector("form");
const input = document.getElementById("password");
const submit = document.getElementById("submit");
const error = document.getElementById("error");
submit.textContent = text.submit;
function fail(message) {
  error.textContent = message;
  error.hidden = false;
  input.setAttribute("aria-invalid", "true");
  submit.disabled = false;
  submit.textContent = text.submit;
  input.focus();
  input.select();
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!input.value || submit.disabled) return;
  submit.disabled = true;
  submit.textContent = text.signingIn;
  error.hidden = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: input.value }),
    });
    if (response.ok) return location.replace("/");
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After")) || 30;
      return fail(text.locked.replace("{seconds}", String(seconds)));
    }
    fail(response.status === 401 ? text.wrong : text.failed);
  } catch {
    fail(text.failed);
  }
});
input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
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
<main>
  <div class="brand"><span class="mark">${PINE_MARK}</span>Pine</div>
  <h1 id="title"></h1>
  <p id="detail"></p>
  <form>
    <label id="label" for="password"></label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <p class="error" id="error" role="alert" hidden></p>
    <button type="submit" id="submit"></button>
  </form>
</main>
<script nonce="${nonce}">${script}</script>
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      },
    },
  );
}
