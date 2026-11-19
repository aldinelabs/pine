// Runs in an Electron utilityProcess: reports whether WebGPU exists there.
process.parentPort.postMessage({
  navigatorType: typeof globalThis.navigator,
  gpuType: typeof globalThis.navigator?.gpu,
});
process.exit(0);
