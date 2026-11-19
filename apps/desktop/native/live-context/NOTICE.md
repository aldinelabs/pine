# Third-party components for Live Context speaker labels

Pine (AGPL-3.0) ships these inside the macOS app for on-device speaker
diarization; nothing is downloaded at runtime. All licenses below are
compatible with distribution under the AGPL-3.0. The full texts are in
`licenses/` beside the models (`live-context-models` in the app's Resources).

| Component                                                                              | Version                          | Where it comes from                                                                                                | License                                                                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| sherpa-onnx C API (`libsherpa-onnx-c-api.dylib`)                                       | 2.0.1                            | `sherpa-onnx-v2.0.1-osx-universal2-shared-no-tts-lib.tar.bz2` from github.com/k2-fsa/sherpa-onnx releases, bundled | Apache-2.0 (© Xiaomi Corporation and the k2-fsa authors)                                                   |
| ONNX Runtime (`libonnxruntime.dylib`)                                                  | as built into sherpa-onnx 2.0.1  | same archive, bundled                                                                                              | MIT (© Microsoft Corporation)                                                                              |
| pyannote segmentation-3.0 (`model.int8.onnx`)                                          | sherpa-onnx export of 2024-10-08 | huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0 at commit `9403a69`, bundled                       | MIT (© 2022 CNRS)                                                                                          |
| 3D-Speaker CAM++ zh/en (`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`) | sherpa-onnx export of 2024-10-14 | huggingface.co/csukuangfj/speaker-embedding-models at commit `0743f30`, bundled                                    | Apache-2.0 (© Alibaba / 3D-Speaker authors; ModelScope `iic/speech_campplus_sv_zh_en_16k-common_advanced`) |

Apache-2.0: `licenses/Apache-2.0.txt` (https://www.apache.org/licenses/LICENSE-2.0)
MIT (pyannote segmentation-3.0, © 2022 CNRS): `licenses/pyannote-segmentation-3.0-MIT.txt`
MIT (ONNX Runtime): https://opensource.org/license/mit
