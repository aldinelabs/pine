// pi-vcc ships TypeScript source that fails Pine's strict checks against Pi
// 1.x types. Re-exporting through JS keeps vue-tsc on pi-vcc.d.ts while Vite
// still bundles the real module.
export { registerBeforeCompactHook } from "@sting8k/pi-vcc/src/hooks/before-compact";
