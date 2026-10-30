/**
 * Shared contracts for SignBridge.
 *
 * This file is the ONLY place the three workstreams (sign-to-text, speech-to-sign,
 * Gemma cleanup) agree on shapes. Change it only by team agreement, because every
 * owner's code depends on it.
 */

/** One MediaPipe hand landmark. x/y are normalized to the image (0..1); z is relative depth. */
export type Landmark = { x: number; y: number; z: number };

/** One labelled training example: the label plus its normalized feature vector (129 numbers: two hands + their offset). */
export type Sample = { label: string; features: number[] };

/** A classifier result. `confidence` is in 0..1. */
export type Prediction = { label: string; confidence: number };

/** Props of the <SignToText /> component. `onText` fires on every transcript change. */
export type SignToTextProps = { onText: (text: string) => void };

/**
 * Signature of the Gemma transcript cleaner (src/lib/gemma.ts, owned by teammate C).
 * Declared here so the contract is visible next to the others.
 */
export type CleanTranscript = (raw: string) => Promise<string>;
