import type { IceServer } from "./signaling";

/**
 * Each side sends all its candidates in one description, so it waits for
 * gathering. Browsers can take tens of seconds to call gathering complete
 * while the useful candidates arrive in milliseconds, so a side stops waiting
 * once it has the best kind its servers can give, after a short grace.
 */
export const GATHER_GRACE_MS = 250;
export const GATHER_MAX_MS = 4_000;

export type CandidateType = "host" | "srflx" | "prflx" | "relay";

/** The candidate worth waiting for: a relay when there is TURN, else STUN's. */
export function wantedCandidate(
  servers: IceServer[],
): CandidateType | undefined {
  const urls = servers.flatMap((server) => server.urls);
  if (urls.some((url) => /^turns?:/i.test(url))) return "relay";
  if (urls.some((url) => /^stun:/i.test(url))) return "srflx";
  return undefined;
}

/** Reads "typ relay" and the like from an ICE candidate line. */
export function candidateType(candidate: string): CandidateType | undefined {
  const match = /\btyp (host|srflx|prflx|relay)\b/.exec(candidate);
  return match?.[1] as CandidateType | undefined;
}

/**
 * Resolves when gathering is good enough: complete, the wanted candidate
 * plus grace, or the deadline. Feed it candidates and completion.
 */
export class GatherWatch {
  readonly ready: Promise<void>;
  private finish: () => void = () => undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly deadline: ReturnType<typeof setTimeout>;

  constructor(
    private readonly wanted: CandidateType | undefined,
    maxMs = GATHER_MAX_MS,
  ) {
    this.ready = new Promise((resolve) => {
      this.finish = () => {
        clearTimeout(this.graceTimer);
        clearTimeout(this.deadline);
        resolve();
      };
    });
    this.deadline = setTimeout(() => this.finish(), maxMs);
    // With no servers, host candidates are all there is.
    if (!wanted) this.grace();
  }

  candidate(line: string): void {
    if (this.wanted && candidateType(line) === this.wanted) this.grace();
  }

  complete(): void {
    this.finish();
  }

  private grace(): void {
    this.graceTimer ??= setTimeout(() => this.finish(), GATHER_GRACE_MS);
  }
}
