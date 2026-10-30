import completionSoundUrl from "@/assets/sounds/task-complete.mp3";

/** Play the short cue that tells the user a run has finished. */
export function playCompletionSound(): void {
  const audio = new Audio(completionSoundUrl);
  audio.volume = 0.6;
  // Autoplay can be refused before any interaction; the cue is optional.
  void audio.play().catch(() => undefined);
}
