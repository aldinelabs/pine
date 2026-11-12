/**
 * Entry of the streaming trace page, driven by
 * apps/desktop/scripts/verify-stream-perf.mjs. The probe below is installed
 * before any application module loads, so every frame callback the app
 * schedules is counted.
 */

/** A point in time to measure a phase from or to. */
export interface StreamPerfCursor {
  at: number;
  rafCallbacks: number;
  rafFrames: number;
}

export interface StreamPerfPhaseStats {
  durationMs: number;
  /** requestAnimationFrame callbacks the app ran (the sampler is excluded). */
  rafCallbacksPerSecond: number;
  /** Frames in which at least one of those callbacks ran. */
  rafFramesPerSecond: number;
  /** Frames the main thread produced, as seen by the sampler. */
  framesPerSecond: number;
  frameIntervalMs: { p50: number; p95: number; max: number };
  /** Null when the browser does not report long tasks. */
  longTasks: { count: number; totalMs: number } | null;
}

export interface StreamPerfProbe {
  /** Starts the per-frame sampler that records frame intervals. */
  startSampling: () => void;
  stopSampling: () => void;
  cursor: () => StreamPerfCursor;
  summarize: (
    from: StreamPerfCursor,
    to: StreamPerfCursor,
  ) => StreamPerfPhaseStats;
}

export type StreamPerfWindow = Window & {
  pineStreamPerfProbe?: StreamPerfProbe;
  /** Bound by the driving script; snapshots the browser's own counters. */
  pineStreamPerfMark?: (name: string) => Promise<void>;
  pineStreamPerfTest?: {
    run: (options?: { phaseMs?: number }) => Promise<unknown>;
  };
};

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

function installProbe(): StreamPerfProbe {
  const nativeRequestFrame = window.requestAnimationFrame.bind(window);
  let rafCallbacks = 0;
  let rafFrames = 0;
  let lastRafFrame = -1;
  window.requestAnimationFrame = (callback) =>
    nativeRequestFrame((time) => {
      rafCallbacks++;
      if (time !== lastRafFrame) {
        lastRafFrame = time;
        rafFrames++;
      }
      callback(time);
    });

  const frameTimes: number[] = [];
  let sampling = false;
  function sample(time: number): void {
    if (!sampling) return;
    frameTimes.push(time);
    nativeRequestFrame(sample);
  }

  const longTasks: { start: number; duration: number }[] = [];
  const reportsLongTasks =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask");
  if (reportsLongTasks) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask" });
  }

  return {
    startSampling() {
      if (sampling) return;
      sampling = true;
      nativeRequestFrame(sample);
    },
    stopSampling() {
      sampling = false;
    },
    cursor: () => ({ at: performance.now(), rafCallbacks, rafFrames }),
    summarize(from, to) {
      const seconds = Math.max(0.001, (to.at - from.at) / 1_000);
      const frames = frameTimes.filter(
        (time) => time >= from.at && time < to.at,
      );
      const intervals = frames
        .slice(1)
        .map((time, index) => time - frames[index])
        .sort((a, b) => a - b);
      const tasks = longTasks.filter(
        (task) => task.start >= from.at && task.start < to.at,
      );
      return {
        durationMs: round(to.at - from.at),
        rafCallbacksPerSecond: round(
          (to.rafCallbacks - from.rafCallbacks) / seconds,
        ),
        rafFramesPerSecond: round((to.rafFrames - from.rafFrames) / seconds),
        framesPerSecond: round(frames.length / seconds),
        frameIntervalMs: {
          p50: round(percentile(intervals, 0.5)),
          p95: round(percentile(intervals, 0.95)),
          max: round(intervals[intervals.length - 1] ?? 0),
        },
        longTasks: reportsLongTasks
          ? {
              count: tasks.length,
              totalMs: round(
                tasks.reduce((total, task) => total + task.duration, 0),
              ),
            }
          : null,
      };
    },
  };
}

(window as StreamPerfWindow).pineStreamPerfProbe = installProbe();

const [{ createApp }, { createPinia }, { createAppI18n }, scenario] =
  await Promise.all([
    import("vue"),
    import("pinia"),
    import("@/app/i18n"),
    import("./StreamPerfScenario.vue"),
    import("./styles.css"),
  ]);

createApp(scenario.default)
  .use(createPinia())
  .use(createAppI18n("en-US"))
  .mount("#app");
