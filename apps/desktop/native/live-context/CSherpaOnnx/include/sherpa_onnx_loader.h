// Speaker diarization for the Live Context helper, on top of sherpa-onnx's C
// API. The library is opened with dlopen only when a capture asks for
// speakers, so the helper neither links nor loads it otherwise, and still
// runs when the library is missing.
#ifndef PINE_SHERPA_ONNX_LOADER_H
#define PINE_SHERPA_ONNX_LOADER_H

#include <stdint.h>

/** One speaker turn from the segmentation model, in seconds. */
typedef struct PineSpeakerTurn {
  float start;
  float end;
  /** The model's own speaker index, local to one window. */
  int32_t speaker;
} PineSpeakerTurn;

typedef struct PineSherpaEngine PineSherpaEngine;

/**
 * Opens libsherpa-onnx-c-api.dylib at `library_path`. Returns NULL on
 * success, else a message. Safe to call again once it succeeded.
 */
const char *pine_sherpa_load(const char *library_path);

/**
 * NULL when a model fails to load (the library logs why to stderr).
 * `provider` is ONNX Runtime's execution provider: "cpu" or "coreml".
 */
PineSherpaEngine *pine_sherpa_create(const char *segmentation_model,
                                     const char *embedding_model,
                                     int32_t num_threads,
                                     const char *provider);
void pine_sherpa_destroy(PineSherpaEngine *engine);
int32_t pine_sherpa_sample_rate(const PineSherpaEngine *engine);
int32_t pine_sherpa_embedding_dim(const PineSherpaEngine *engine);
/** Samples the segmentation model looks at in one pass (10 s). */
int32_t pine_sherpa_window_samples(const PineSherpaEngine *engine);

/**
 * Speaker turns in at most one window of 16 kHz mono audio. With no more
 * than one window, sherpa-onnx runs only the segmentation model (no
 * embeddings, no clustering), which is what streaming needs. Returns the
 * number of turns written, or -1.
 */
int32_t pine_sherpa_segment(const PineSherpaEngine *engine,
                            const float *samples, int32_t count,
                            PineSpeakerTurn *turns, int32_t max_turns);

/**
 * A speaker embedding of 16 kHz mono audio into `embedding`
 * (pine_sherpa_embedding_dim floats). Returns 1, or 0 when the audio is too
 * short or the model gives NaN.
 */
int32_t pine_sherpa_embed(const PineSherpaEngine *engine, const float *samples,
                          int32_t count, float *embedding);

#endif
