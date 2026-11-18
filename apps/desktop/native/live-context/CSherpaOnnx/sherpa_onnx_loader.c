#include "sherpa_onnx_loader.h"

#include <dlfcn.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

// The structs below mirror sherpa-onnx v2.0.1's c-api.h
// (sherpa-onnx/c-api/c-api.h), whose ABI scripts/build-native.mjs pins.
// Update them together with the library version.

typedef struct SherpaOnnxSpeakerEmbeddingExtractorConfig {
  const char *model;
  int32_t num_threads;
  int32_t debug;
  const char *provider;
} SherpaOnnxSpeakerEmbeddingExtractorConfig;

typedef struct SherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig {
  const char *model;
  float window_shift_ratio;
} SherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig;

typedef struct SherpaOnnxOfflineSpeakerSegmentationModelConfig {
  SherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig pyannote;
  int32_t num_threads;
  int32_t debug;
  const char *provider;
} SherpaOnnxOfflineSpeakerSegmentationModelConfig;

typedef struct SherpaOnnxFastClusteringConfig {
  int32_t num_clusters;
  float threshold;
  int32_t compute_confidence;
} SherpaOnnxFastClusteringConfig;

typedef struct SherpaOnnxOfflineSpeakerDiarizationConfig {
  SherpaOnnxOfflineSpeakerSegmentationModelConfig segmentation;
  SherpaOnnxSpeakerEmbeddingExtractorConfig embedding;
  SherpaOnnxFastClusteringConfig clustering;
  float min_duration_on;
  float min_duration_off;
} SherpaOnnxOfflineSpeakerDiarizationConfig;

typedef struct SherpaOnnxOfflineSpeakerDiarizationSegment {
  float start;
  float end;
  int32_t speaker;
  float confidence;
} SherpaOnnxOfflineSpeakerDiarizationSegment;

typedef void Opaque;

static struct {
  void *handle;
  const Opaque *(*create_diarization)(
      const SherpaOnnxOfflineSpeakerDiarizationConfig *);
  void (*destroy_diarization)(const Opaque *);
  int32_t (*diarization_sample_rate)(const Opaque *);
  const Opaque *(*process)(const Opaque *, const float *, int32_t);
  int32_t (*result_segments)(const Opaque *);
  const SherpaOnnxOfflineSpeakerDiarizationSegment *(*sorted_segments)(
      const Opaque *);
  void (*destroy_segments)(const SherpaOnnxOfflineSpeakerDiarizationSegment *);
  void (*destroy_result)(const Opaque *);
  const Opaque *(*create_extractor)(
      const SherpaOnnxSpeakerEmbeddingExtractorConfig *);
  void (*destroy_extractor)(const Opaque *);
  int32_t (*extractor_dim)(const Opaque *);
  const Opaque *(*create_stream)(const Opaque *);
  void (*accept_waveform)(const Opaque *, int32_t, const float *, int32_t);
  void (*input_finished)(const Opaque *);
  int32_t (*is_ready)(const Opaque *, const Opaque *);
  const float *(*compute_embedding)(const Opaque *, const Opaque *);
  void (*destroy_embedding)(const float *);
  void (*destroy_stream)(const Opaque *);
} api;

struct PineSherpaEngine {
  const Opaque *diarization;
  const Opaque *extractor;
  int32_t sample_rate;
  int32_t dim;
};

#define LOAD(field, name)                       \
  do {                                          \
    *(void **)(&api.field) = dlsym(handle, name); \
    if (!api.field) return "Missing " name ".";   \
  } while (0)

static const char *load_symbols(void *handle) {
  LOAD(create_diarization, "SherpaOnnxCreateOfflineSpeakerDiarization");
  LOAD(destroy_diarization, "SherpaOnnxDestroyOfflineSpeakerDiarization");
  LOAD(diarization_sample_rate,
       "SherpaOnnxOfflineSpeakerDiarizationGetSampleRate");
  LOAD(process, "SherpaOnnxOfflineSpeakerDiarizationProcess");
  LOAD(result_segments,
       "SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments");
  LOAD(sorted_segments,
       "SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime");
  LOAD(destroy_segments, "SherpaOnnxOfflineSpeakerDiarizationDestroySegment");
  LOAD(destroy_result, "SherpaOnnxOfflineSpeakerDiarizationDestroyResult");
  LOAD(create_extractor, "SherpaOnnxCreateSpeakerEmbeddingExtractor");
  LOAD(destroy_extractor, "SherpaOnnxDestroySpeakerEmbeddingExtractor");
  LOAD(extractor_dim, "SherpaOnnxSpeakerEmbeddingExtractorDim");
  LOAD(create_stream, "SherpaOnnxSpeakerEmbeddingExtractorCreateStream");
  LOAD(accept_waveform, "SherpaOnnxOnlineStreamAcceptWaveform");
  LOAD(input_finished, "SherpaOnnxOnlineStreamInputFinished");
  LOAD(is_ready, "SherpaOnnxSpeakerEmbeddingExtractorIsReady");
  LOAD(compute_embedding,
       "SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding");
  LOAD(destroy_embedding,
       "SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding");
  LOAD(destroy_stream, "SherpaOnnxDestroyOnlineStream");
  return NULL;
}

const char *pine_sherpa_load(const char *library_path) {
  if (api.handle) return NULL;
  void *handle = dlopen(library_path, RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    const char *error = dlerror();
    return error ? error : "dlopen failed.";
  }
  const char *error = load_symbols(handle);
  if (error) {
    dlclose(handle);
    memset(&api, 0, sizeof(api));
    return error;
  }
  api.handle = handle;
  return NULL;
}

PineSherpaEngine *pine_sherpa_create(const char *segmentation_model,
                                     const char *embedding_model,
                                     int32_t num_threads,
                                     const char *provider) {
  if (!api.handle) return NULL;
  SherpaOnnxSpeakerEmbeddingExtractorConfig embedding;
  memset(&embedding, 0, sizeof(embedding));
  embedding.model = embedding_model;
  embedding.num_threads = num_threads;
  embedding.provider = provider;

  SherpaOnnxOfflineSpeakerDiarizationConfig config;
  memset(&config, 0, sizeof(config));
  config.segmentation.pyannote.model = segmentation_model;
  config.segmentation.num_threads = num_threads;
  config.segmentation.provider = provider;
  // Never used: one window at a time skips sherpa-onnx's own embeddings and
  // clustering, but the config must name a model.
  config.embedding = embedding;
  config.clustering.num_clusters = 1;
  config.min_duration_on = 0.3f;
  config.min_duration_off = 0.5f;

  const Opaque *diarization = api.create_diarization(&config);
  if (!diarization) return NULL;
  const Opaque *extractor = api.create_extractor(&embedding);
  if (!extractor) {
    api.destroy_diarization(diarization);
    return NULL;
  }
  PineSherpaEngine *engine = calloc(1, sizeof(PineSherpaEngine));
  if (!engine) {
    api.destroy_extractor(extractor);
    api.destroy_diarization(diarization);
    return NULL;
  }
  engine->diarization = diarization;
  engine->extractor = extractor;
  engine->sample_rate = api.diarization_sample_rate(diarization);
  engine->dim = api.extractor_dim(extractor);
  return engine;
}

void pine_sherpa_destroy(PineSherpaEngine *engine) {
  if (!engine) return;
  api.destroy_extractor(engine->extractor);
  api.destroy_diarization(engine->diarization);
  free(engine);
}

int32_t pine_sherpa_sample_rate(const PineSherpaEngine *engine) {
  return engine->sample_rate;
}

int32_t pine_sherpa_embedding_dim(const PineSherpaEngine *engine) {
  return engine->dim;
}

int32_t pine_sherpa_window_samples(const PineSherpaEngine *engine) {
  // pyannote segmentation-3.0 sees 10 s per pass (its window_size metadata).
  return engine->sample_rate * 10;
}

int32_t pine_sherpa_segment(const PineSherpaEngine *engine,
                            const float *samples, int32_t count,
                            PineSpeakerTurn *turns, int32_t max_turns) {
  if (count <= 0 || count > pine_sherpa_window_samples(engine)) return -1;
  const Opaque *result = api.process(engine->diarization, samples, count);
  if (!result) return 0;
  int32_t total = api.result_segments(result);
  int32_t written = 0;
  if (total > 0) {
    const SherpaOnnxOfflineSpeakerDiarizationSegment *segments =
        api.sorted_segments(result);
    if (segments) {
      for (int32_t i = 0; i < total && written < max_turns; ++i) {
        turns[written].start = segments[i].start;
        turns[written].end = segments[i].end;
        turns[written].speaker = segments[i].speaker;
        written += 1;
      }
      api.destroy_segments(segments);
    }
  }
  api.destroy_result(result);
  return written;
}

int32_t pine_sherpa_embed(const PineSherpaEngine *engine, const float *samples,
                          int32_t count, float *embedding) {
  const Opaque *stream = api.create_stream(engine->extractor);
  if (!stream) return 0;
  api.accept_waveform(stream, engine->sample_rate, samples, count);
  api.input_finished(stream);
  int32_t ok = 0;
  if (api.is_ready(engine->extractor, stream)) {
    const float *vector = api.compute_embedding(engine->extractor, stream);
    if (vector) {
      ok = 1;
      for (int32_t i = 0; i < engine->dim; ++i) {
        if (isnan(vector[i])) ok = 0;
        embedding[i] = vector[i];
      }
      api.destroy_embedding(vector);
    }
  }
  api.destroy_stream(stream);
  return ok;
}
