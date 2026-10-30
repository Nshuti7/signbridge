import type { Landmark } from "../types";

/** MediaPipe always reports 21 landmarks per hand. */
export const LANDMARK_COUNT = 21;
/** One hand = 21 landmarks x (x, y, z) */
export const HAND_FEATURE_LENGTH = LANDMARK_COUNT * 3;
/**
 * Full vector = [left hand 63][right hand 63][left->right wrist offset 3].
 * A hand that is not visible is filled with zeros, so one-handed signs still work and
 * are naturally far (in KNN distance) from two-handed signs.
 */
export const FEATURE_LENGTH = HAND_FEATURE_LENGTH * 2 + 3;

const WRIST = 0;
const MIDDLE_FINGER_MCP = 9; // the knuckle where the middle finger meets the palm

/** One detected hand: its landmarks and the side MediaPipe says it is ("Left" | "Right"). */
export type DetectedHand = { landmarks: Landmark[]; side: string };

/** Palm length (wrist -> middle-finger knuckle), including z so a tilted palm is measured correctly. */
function palmLength(lm: Landmark[]): number {
  return Math.hypot(
    lm[MIDDLE_FINGER_MCP].x - lm[WRIST].x,
    lm[MIDDLE_FINGER_MCP].y - lm[WRIST].y,
    lm[MIDDLE_FINGER_MCP].z - lm[WRIST].z,
  );
}

/**
 * Turn ONE hand's raw landmarks into 63 numbers that do not depend on WHERE the hand is
 * in the frame or HOW FAR it is from the camera. Returns null for unusable input.
 */
export function normalizeHand(lm: Landmark[]): number[] | null {
  if (lm.length !== LANDMARK_COUNT) return null;
  const wrist = lm[WRIST];

  // STEP 1 - the scale reference. A hand twice as close looks twice as big, so every
  // coordinate doubles; dividing by a length measured ON the hand cancels that out.
  // The palm length is a good ruler: it barely changes when fingers curl or spread.
  const scale = palmLength(lm);
  // Guard against dividing by (almost) zero, which would blow features up to Infinity.
  if (scale < 1e-6) return null;

  // STEP 2 - translate THEN scale. Subtracting the wrist makes it the origin, so moving
  // the hand around the frame changes nothing. Translate first, or the offset gets scaled too.
  const out: number[] = new Array(HAND_FEATURE_LENGTH);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    out[i * 3] = (lm[i].x - wrist.x) / scale;
    out[i * 3 + 1] = (lm[i].y - wrist.y) / scale;
    out[i * 3 + 2] = (lm[i].z - wrist.z) / scale;
  }
  return out;
}

/**
 * Build the full feature vector from up to two hands. Returns null if no hand is usable.
 */
export function normalizeHands(hands: DetectedHand[]): number[] | null {
  // Each hand is normalized on its own (shape), but many two-handed signs are defined by
  // how the hands sit relative to each other (e.g. one above the other), and per-hand
  // normalization throws that away. So we add the wrist-to-wrist offset at the end.
  const usable = hands
    .map((h) => ({ ...h, features: normalizeHand(h.landmarks) }))
    .filter((h): h is DetectedHand & { features: number[] } => h.features !== null)
    .slice(0, 2);
  if (usable.length === 0) return null;

  // Put each hand in a FIXED slot (left = 0, right = 1). If the vector order depended on
  // detection order, the same sign could swap halves from frame to frame and never match.
  let left = usable.find((h) => h.side === "Left");
  let right = usable.find((h) => h.side === "Right");
  if (usable.length === 2 && (!left || !right)) {
    // MediaPipe labelled both hands the same side (it happens). Fall back to screen position.
    const [a, b] = [...usable].sort((p, q) => p.landmarks[WRIST].x - q.landmarks[WRIST].x);
    left = a;
    right = b;
  } else if (usable.length === 1 && !left && !right) {
    left = usable[0];
  }

  const zeros = new Array<number>(HAND_FEATURE_LENGTH).fill(0);
  const vector = [...(left?.features ?? zeros), ...(right?.features ?? zeros)];

  if (left && right) {
    // Offset between wrists, in units of the average palm length so it is camera-distance independent.
    const scale = (palmLength(left.landmarks) + palmLength(right.landmarks)) / 2;
    const lw = left.landmarks[WRIST];
    const rw = right.landmarks[WRIST];
    vector.push((rw.x - lw.x) / scale, (rw.y - lw.y) / scale, (rw.z - lw.z) / scale);
  } else {
    vector.push(0, 0, 0);
  }
  return vector;
}
