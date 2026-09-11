# Local measurement assets

- `mediapipe/`: Google MediaPipe Tasks Vision **0.10.32**, from the npm package `@mediapipe/tasks-vision`. License: Apache-2.0 (see `LICENSE-Apache-2.0.txt`). Original source notices remain in the distributed bundles.
- `face_landmarker.task`: Google MediaPipe Face Landmarker float16 **version 1**, downloaded from the URL recorded in `manifest.json`. The model contains the face detection and landmark pipelines; it is not a heart-rate or respiratory-rate model.
- `manifest.json`: source version, model URL, and SHA-256 checksums of the six runtime assets.

Algorithm references (these Python packages are not runtime dependencies):

- `../resPyre/riv/resp_from_rPPG.py`: the reference project's peak-based amplitude and interval modulation approach. Original project license: GPL-3.0, retained in `resPyre/LICENSE`. This demo implements its own timestamp interpolation, signal processing and agreement checks in JavaScript; it does not execute or bundle resPyre's Python or deep-learning models.
- de Haan & Jeanne, “Robust pulse rate from chrominance-based rPPG” (2013), https://pubmed.ncbi.nlm.nih.gov/23744659/.
- MediaPipe web face landmark documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js.
