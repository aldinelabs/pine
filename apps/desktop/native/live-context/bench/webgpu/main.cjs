// Minimal Electron harness for the WebGPU candidate (transformers.js +
// ONNX Runtime Web). A hidden, sandboxed, Node-free BrowserWindow does the
// compute, the way Pine would host it; files come from a custom protocol
// that only serves the given roots (models, the ORT/transformers dist, audio).
//
//   electron main.cjs --root <scratch> --clip <name> --model <repo> --device webgpu|wasm
//     [--dtype '{"encoder_model":"fp16","decoder_model_merged":"q4"}'] [--lang zh]
//     [--task asr|diar] [--segments <sherpa stdout jsonl>]
//
// Every renderer `console.log("BENCH {...}")` line is printed to stdout as JSON.
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS Electron entry, run directly by electron */
const {
  app,
  BrowserWindow,
  protocol,
  net,
  utilityProcess,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const argv = process.argv;
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const root = path.resolve(arg("root"));
const roots = {
  m: path.join(root, "models/hf"),
  n: path.join(root, "webgpu/node_modules"),
  a: path.join(root, "audio"),
  r: path.join(root, "results"),
  h: __dirname,
};
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");

// Chromium/Dawn caches (shader and pipeline caches included) stay in scratch,
// not in the shared default ~/Library/Application Support/Electron profile.
app.setPath(
  "userData",
  path.resolve(arg("user-data", path.join(root, "webgpu/userdata"))),
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "pinebench",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  protocol.handle("pinebench", (request) => {
    const url = new URL(request.url);
    const base = roots[url.hostname];
    const file = path.normalize(
      path.join(base ?? "/nonexistent", decodeURIComponent(url.pathname)),
    );
    if (!base || !file.startsWith(base))
      return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // WebGPU is a Blink feature: a utilityProcess (Node only) has no navigator.gpu.
  const probe = utilityProcess.fork(path.join(__dirname, "utility-probe.cjs"));
  probe.on("message", (m) =>
    emit({ type: "bench", phase: "utility-probe", ...m }),
  );

  // A renderer that fails before it can report (e.g. a module error) exits too.
  let watchdog;
  const kick = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(
      () => {
        emit({ type: "bench", phase: "timeout" });
        app.exit(3);
      },
      Number(arg("timeout", "600")) * 1000,
    );
  };
  kick();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (event) => {
    const message = event.message ?? "";
    kick();
    if (message.startsWith("BENCH ")) {
      const ev = JSON.parse(message.slice(6));
      emit(ev);
      if (ev.phase === "exit") app.exit(ev.code ?? 0);
    } else if (event.level === "error" || event.level === 3) {
      process.stderr.write(`[renderer] ${message}\n`);
      if (message.startsWith("Uncaught")) {
        emit({ type: "bench", phase: "error", message });
        app.exit(1);
      }
    }
  });
  win.webContents.on("render-process-gone", (_e, d) => {
    emit({ type: "bench", phase: "crash", reason: d.reason });
    app.exit(2);
  });
  const query = new URLSearchParams({
    clip: arg("clip"),
    model: arg("model", ""),
    device: arg("device", "webgpu"),
    dtype: arg("dtype", ""),
    lang: arg("lang", ""),
    task: arg("task", "asr"),
    segments: arg("segments")
      ? `pinebench://r/${path.relative(roots.r, path.resolve(arg("segments")))}`
      : "",
  });
  await win.loadURL(`pinebench://h/index.html?${query}`);
});
