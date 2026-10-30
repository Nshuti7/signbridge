import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// The wasm runtime is fetched from a CDN. Pin the version to the installed
// package so the JS API and the wasm binary always match.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";

// The model itself is served from /public, so it works without internet once
// the wasm files are cached by the browser. `BASE_URL` keeps this working when
// the app is deployed under a sub-path.
const MODEL_URL = `${import.meta.env.BASE_URL}hand_landmarker.task`;

/**
 * Create a HandLandmarker in VIDEO mode (it tracks between frames, which is
 * faster and steadier than treating each frame as an unrelated photo).
 * Tries the GPU first and falls back to CPU if the GPU delegate fails.
 */
export async function createHandLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  const make = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 1, // one hand keeps the feature vector a fixed 63 numbers
    });

  try {
    return await make("GPU");
  } catch (err) {
    console.warn("GPU delegate unavailable, falling back to CPU:", err);
    return await make("CPU");
  }
}
