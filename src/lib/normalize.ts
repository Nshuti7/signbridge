import type { Landmark } from "../types";

/** MediaPipe always reports 21 landmarks per hand. */
export const LANDMARK_COUNT = 21;
/** 21 landmarks x (x, y, z) */
export const FEATURE_LENGTH = LANDMARK_COUNT * 3;

const WRIST = 0;
const MIDDLE_FINGER_MCP = 9; // the knuckle where the middle finger meets the palm

/**
 * Turn raw landmarks into a 63-number feature vector that does not depend on
 * WHERE the hand is in the frame or HOW FAR it is from the camera.
 *
 * Returns null if the input is unusable (wrong length, or a degenerate hand).
 */
export function normalizeLandmarks(landmarks: Landmark[]): number[] | null {
  if (landmarks.length !== LANDMARK_COUNT) return null;

  const wrist = landmarks[WRIST];
  const mcp = landmarks[MIDDLE_FINGER_MCP];

  // STEP 1 - the scale reference.
  // A hand twice as close to the camera looks twice as big, so all coordinates
  // double. If we divide every coordinate by a length measured ON the hand, that
  // size change cancels out. Wrist -> middle-finger knuckle is a good ruler: it
  // is the palm's length, it barely changes when you curl or spread your fingers,
  // and it is never ~0 unless the hand is pointing straight at the camera.
  // We include z in the distance so the ruler stays correct when the palm tilts.
  const dx = mcp.x - wrist.x;
  const dy = mcp.y - wrist.y;
  const dz = mcp.z - wrist.z;
  const scale = Math.hypot(dx, dy, dz);

  // Guard against dividing by (almost) zero, which would blow features up to Infinity.
  if (scale < 1e-6) return null;

  // STEP 2 - translate then scale, per landmark.
  // Subtracting the wrist makes the wrist the origin (0,0,0), so moving the hand
  // around the frame changes nothing. Dividing by `scale` removes the distance
  // effect. Order matters: translate first, otherwise the offset would be scaled too.
  const features: number[] = new Array(FEATURE_LENGTH);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    features[i * 3] = (landmarks[i].x - wrist.x) / scale;
    features[i * 3 + 1] = (landmarks[i].y - wrist.y) / scale;
    features[i * 3 + 2] = (landmarks[i].z - wrist.z) / scale;
  }
  return features;
}
