import type { Prediction, Sample } from "../types";

/** Number of neighbours that vote. */
export const K = 5;

/**
 * If even the CLOSEST training sample is farther than this, we say "unknown".
 * Units: normalized feature space (palm lengths), so the number is camera-independent.
 * ESTIMATE, not measured: one-hand distances were guessed at ~1.2, and two hands add
 * roughly sqrt(2) more dimensions worth of noise, hence 1.7. Tune it on real data:
 * raise it if known signs show as unknown, lower it if random shapes get labelled.
 */
export const UNKNOWN_DISTANCE = 1.7;

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Classify `features` against `samples`.
 * Returns null when there is no training data or the hand matches nothing we know.
 */
export function predict(
  samples: Sample[],
  features: number[],
  k: number = K,
  unknownDistance: number = UNKNOWN_DISTANCE,
): Prediction | null {
  if (samples.length === 0) return null;

  // Distance to every sample, then keep the k smallest. With a few hundred
  // samples a full sort is plenty fast (it runs once per video frame).
  const neighbours = samples
    .map((s) => ({ label: s.label, distance: euclidean(s.features, features) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);

  // "Unknown sign" gate: judged on the single nearest neighbour. Without it, KNN
  // always answers with SOMETHING, even for a random hand shape, because it only
  // ever picks the best of what it has seen.
  if (neighbours[0].distance > unknownDistance) return null;

  // Distance-weighted voting: closer neighbours count more. The 1/(d + eps)
  // weight keeps an exact match (d = 0) from dividing by zero.
  const votes = new Map<string, number>();
  let total = 0;
  for (const n of neighbours) {
    const w = 1 / (n.distance + 1e-6);
    votes.set(n.label, (votes.get(n.label) ?? 0) + w);
    total += w;
  }

  let bestLabel = "";
  let bestWeight = -1;
  for (const [label, weight] of votes) {
    if (weight > bestWeight) {
      bestLabel = label;
      bestWeight = weight;
    }
  }

  // Confidence = winner's share of the total weighted vote (0..1).
  return { label: bestLabel, confidence: bestWeight / total };
}
