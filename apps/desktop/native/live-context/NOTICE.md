# Third-party components for Live Context speaker labels

Pine (AGPL-3.0) ships or downloads these for on-device speaker diarization.
All licenses below are compatible with distribution under the AGPL-3.0.

| Component                                                                              | Version                          | Where it comes from                                                                                                | License                                                                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| sherpa-onnx C API (`libsherpa-onnx-c-api.dylib`)                                       | 2.0.1                            | `sherpa-onnx-v2.0.1-osx-universal2-shared-no-tts-lib.tar.bz2` from github.com/k2-fsa/sherpa-onnx releases, bundled | Apache-2.0 (© Xiaomi Corporation and the k2-fsa authors)                                                   |
| ONNX Runtime (`libonnxruntime.dylib`)                                                  | as built into sherpa-onnx 2.0.1  | same archive, bundled                                                                                              | MIT (© Microsoft Corporation)                                                                              |
| pyannote segmentation-3.0 (`model.int8.onnx`)                                          | sherpa-onnx export of 2024-10-08 | `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`, downloaded on first use                                           | MIT (© 2022 CNRS)                                                                                          |
| 3D-Speaker CAM++ zh/en (`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`) | sherpa-onnx export of 2024-10-14 | sherpa-onnx `speaker-recongition-models` release, downloaded on first use                                          | Apache-2.0 (© Alibaba / 3D-Speaker authors; ModelScope `iic/speech_campplus_sv_zh_en_16k-common_advanced`) |

Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
MIT: https://opensource.org/license/mit
