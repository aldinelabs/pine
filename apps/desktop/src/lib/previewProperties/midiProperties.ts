import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";

/** What Details needs from a parsed MIDI file (a `@tonejs/midi` `Midi`). */
export interface MidiSummary {
  name: string;
  header: {
    tempos: readonly { bpm: number }[];
    timeSignatures: readonly { timeSignature: readonly number[] }[];
  };
  tracks: readonly { notes: readonly unknown[] }[];
}

/**
 * Title (the first track's name), playable tracks, the opening tempo and time
 * signature. `formatTempo` renders BPM in the user's language.
 */
export function midiProperties(
  midi: MidiSummary,
  formatTempo: (bpm: number) => string,
): PreviewProperty[] {
  const properties: PreviewProperty[] = [];
  const title = midi.name.trim();
  if (title) properties.push({ key: "title", value: title });
  const tracks = midi.tracks.filter((track) => track.notes.length).length;
  if (tracks) properties.push({ key: "tracks", type: "number", value: tracks });
  const bpm = midi.header.tempos[0]?.bpm;
  if (bpm && Number.isFinite(bpm))
    properties.push({ key: "tempo", value: formatTempo(Math.round(bpm)) });
  const signature = midi.header.timeSignatures[0]?.timeSignature;
  if (signature?.length === 2)
    properties.push({ key: "timeSignature", value: signature.join("/") });
  return properties;
}
