import { randomBytes } from "node:crypto";

/** The access token stays in the URL fragment and is exchanged for an HttpOnly cookie. */
export function webConnectPage(): Response {
  const nonce = randomBytes(16).toString("base64");
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pine</title>
    <style nonce="${nonce}">body{font:16px system-ui;padding:3rem;max-width:36rem;margin:auto}p{line-height:1.6}</style>
    <body><h1>Pine</h1><p id="status"></p><script nonce="${nonce}">
      const zh = navigator.language.startsWith('zh');
      document.documentElement.lang = zh ? 'zh-CN' : 'en';
      const status = document.getElementById('status');
      status.textContent = zh ? '请从 Pine 设置中打开网页链接。' : 'Open the browser link from Pine settings.';
      const token = new URLSearchParams(location.hash.slice(1)).get('access_token');
      if (token) {
        history.replaceState(null, '', '/');
        status.textContent = zh ? '正在连接…' : 'Connecting…';
        fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
          .then(response => { if (!response.ok) throw new Error(); location.replace('/'); })
          .catch(() => { status.textContent = zh ? '链接已失效，请从 Pine 设置中重新打开。' : 'Reopen the link from Pine settings.'; });
      }
    </script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'`,
      },
    },
  );
}
