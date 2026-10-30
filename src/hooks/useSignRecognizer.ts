import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Landmark, Prediction, Sample } from "../types";
import { createHandLandmarker } from "../lib/handLandmarker";
import { FEATURE_LENGTH, normalizeLandmarks } from "../lib/normalize";
import { predict } from "../lib/knn";

// ---------------------------------------------------------------------------
// Tuning constants. They are all in one place because you WILL want to tweak them.
// ---------------------------------------------------------------------------

/** A prediction must be this confident (0..1) for a frame to count toward stability. */
const MIN_CONFIDENCE = 0.6;
/** ...and the same label must hold for this many consecutive frames (~1/3 s at 30 fps). */
const STABLE_FRAMES = 10;
/**
 * The hand must be missing for this many consecutive frames before we treat it as
 * "left the frame". MediaPipe occasionally drops a single frame while tracking, and
 * without this tolerance a hand held perfectly still could type the same letter twice.
 */
const HAND_GONE_FRAMES = 5;
/**
 * A *different* confident label must be seen this many frames in a row before it
 * counts as "the label changed". Stops a one-frame misclassification from re-arming
 * the current letter.
 */
const LABEL_CHANGE_FRAMES = 3;

const SAMPLES_PER_RECORDING = 30;
/** Minimum gap between captured frames, so 30 samples span about one second. */
const MIN_CAPTURE_GAP_MS = 30;
/** Pause between pressing "Record" and the first capture, so you can get your hand in place. */
const GET_READY_MS = 1500;
/** Give up if the hand was not visible long enough to collect all samples. */
const RECORDING_TIMEOUT_MS = 6000;

const STORAGE_KEY = "signbridge.samples.v1";

export type RecognizerStatus = "loading" | "ready" | "no-camera";
export type RecordingPhase = "idle" | "get-ready" | "recording";

// ---------------------------------------------------------------------------
// Sample (de)serialization helpers
// ---------------------------------------------------------------------------

/** Runtime check, because imported JSON is untrusted: a bad file must not crash the classifier. */
function isSample(value: unknown): value is Sample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.label === "string" &&
    v.label.length > 0 &&
    Array.isArray(v.features) &&
    v.features.length === FEATURE_LENGTH &&
    v.features.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Parse JSON text into samples. Throws a readable Error if it is not a valid dataset. */
function parseSamples(json: string): Sample[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!Array.isArray(data)) throw new Error("Expected a JSON array of samples.");
  const valid = data.filter(isSample);
  if (valid.length === 0 && data.length > 0) {
    throw new Error(`No valid samples found (each needs a label and ${FEATURE_LENGTH} numbers).`);
  }
  return valid;
}

function countByLabel(samples: Sample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of samples) counts[s.label] = (counts[s.label] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

type ActiveRecording = {
  label: string;
  startedAt: number; // when the capture phase begins (after the get-ready pause)
  lastCaptureAt: number;
  captured: Sample[];
  resolve: (count: number) => void;
};

export function useSignRecognizer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Latest raw landmarks (or null). The UI reads this to draw the skeleton without re-rendering. */
  const landmarksRef = useRef<Landmark[] | null>(null);

  const [status, setStatus] = useState<RecognizerStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [currentPrediction, setCurrentPrediction] = useState<Prediction | null>(null);
  const [transcript, setTranscript] = useState("");
  const [samplesPerLabel, setSamplesPerLabel] = useState<Record<string, number>>({});
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");

  // Training data lives in a ref, not state: the detection loop reads it ~30 times a second
  // and must always see the latest value without being re-created on every change.
  const samplesRef = useRef<Sample[]>([]);
  const recordingRef = useRef<ActiveRecording | null>(null);

  /** Replace the dataset, keep derived state + localStorage in sync. */
  const setSamples = useCallback((samples: Sample[]) => {
    samplesRef.current = samples;
    setSamplesPerLabel(countByLabel(samples));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
    } catch (err) {
      // Storage can be full or blocked (private mode). Training still works in memory.
      console.warn("Could not persist samples:", err);
    }
  }, []);

  // ---- Load persisted samples (localStorage first, /samples.json on very first run) ----
  useEffect(() => {
    let cancelled = false;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      try {
        const samples = parseSamples(stored);
        samplesRef.current = samples;
        setSamplesPerLabel(countByLabel(samples));
      } catch (err) {
        console.warn("Ignoring corrupt saved samples:", err);
      }
      return;
    }

    // First run: try the dataset shipped in /public. A missing file is normal, not an error.
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples.json`);
        if (!res.ok) return;
        // Vite's dev server answers unknown URLs with index.html (HTTP 200!), so we cannot
        // trust res.ok alone - parsing fails for HTML and we simply ignore it.
        const samples = parseSamples(await res.text());
        if (!cancelled && samples.length > 0) setSamples(samples);
      } catch {
        /* no usable samples.json - start empty */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setSamples]);

  // ---- Camera + MediaPipe + the requestAnimationFrame detection loop ----
  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let landmarker: Awaited<ReturnType<typeof createHandLandmarker>> | null = null;

    // Per-frame stability state. Plain local variables: they change every frame and
    // the UI never needs to render them.
    let candidate: { label: string; frames: number } | null = null;
    let lastCommitted: string | null = null; // the label we last wrote to the transcript
    let changeCandidate: { label: string; frames: number } | null = null;
    let handMissingFrames = 0;
    let shownPrediction: Prediction | null = null; // what the UI currently displays

    /** Only touch React state when the visible value really changed (avoids 30 renders/s). */
    const showPrediction = (p: Prediction | null) => {
      const same =
        (p === null && shownPrediction === null) ||
        (p !== null &&
          shownPrediction !== null &&
          p.label === shownPrediction.label &&
          Math.round(p.confidence * 100) === Math.round(shownPrediction.confidence * 100));
      if (same) return;
      shownPrediction = p;
      setCurrentPrediction(p);
    };

    const commit = (label: string) => {
      // Single characters ("A", "L") are glued together to spell words.
      // Whole-word labels ("HELLO") get a trailing space so words do not run together.
      const text = label.length === 1 ? label : `${label} `;
      setTranscript((t) => t + text);
    };

    /** Training capture: runs instead of recognition while a recording is active. */
    const handleRecording = (rec: ActiveRecording, features: number[] | null, now: number) => {
      if (now < rec.startedAt) return; // still in the get-ready pause
      setRecordingPhase((p) => (p === "recording" ? p : "recording"));

      if (features && now - rec.lastCaptureAt >= MIN_CAPTURE_GAP_MS) {
        rec.captured.push({ label: rec.label, features });
        rec.lastCaptureAt = now;
      }

      const done = rec.captured.length >= SAMPLES_PER_RECORDING;
      const timedOut = now - rec.startedAt > RECORDING_TIMEOUT_MS;
      if (done || timedOut) {
        recordingRef.current = null;
        setRecordingPhase("idle");
        if (rec.captured.length > 0) setSamples([...samplesRef.current, ...rec.captured]);
        rec.resolve(rec.captured.length);
      }
    };

    /** Recognition + stability filter. Called once per new video frame. */
    const handleRecognition = (features: number[] | null) => {
      // ---- No hand in view ----
      if (!features) {
        candidate = null;
        changeCandidate = null;
        handMissingFrames++;
        // Only after several missing frames do we believe the hand really left,
        // which re-arms the last letter so "LL" can be typed.
        if (handMissingFrames >= HAND_GONE_FRAMES) lastCommitted = null;
        showPrediction(null);
        return;
      }
      handMissingFrames = 0;

      const prediction = predict(samplesRef.current, features);
      showPrediction(prediction);

      // ---- Low confidence or unknown sign: the streak is broken ----
      // We deliberately do NOT clear `lastCommitted` here. The hand is still in view,
      // so a wobble to "unsure" and back to the same sign must not type it twice.
      if (!prediction || prediction.confidence <= MIN_CONFIDENCE) {
        candidate = null;
        return;
      }

      // ---- Track whether the label genuinely changed away from the committed one ----
      if (lastCommitted !== null && prediction.label !== lastCommitted) {
        changeCandidate =
          changeCandidate?.label === prediction.label
            ? { label: prediction.label, frames: changeCandidate.frames + 1 }
            : { label: prediction.label, frames: 1 };
        if (changeCandidate.frames >= LABEL_CHANGE_FRAMES) {
          lastCommitted = null; // re-armed: the old letter may be typed again later
          changeCandidate = null;
        }
      } else {
        changeCandidate = null;
      }

      // ---- Stability counter: same label, consecutive frames ----
      // A classifier flickers between neighbouring signs for a frame or two. Requiring
      // ~10 identical, confident frames in a row filters that noise out.
      candidate =
        candidate?.label === prediction.label
          ? { label: prediction.label, frames: candidate.frames + 1 }
          : { label: prediction.label, frames: 1 };

      // ---- Commit exactly once per "hold" ----
      // `lastCommitted` makes a held sign type one letter, not one every 10 frames.
      if (candidate.frames >= STABLE_FRAMES && candidate.label !== lastCommitted) {
        commit(candidate.label);
        lastCommitted = candidate.label;
        changeCandidate = null;
      }
    };

    let lastVideoTime = -1;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || !landmarker || video.readyState < 2) return;

      // rAF can fire faster than the camera delivers frames; skip duplicates.
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const raw = result.landmarks[0] as Landmark[] | undefined;
      landmarksRef.current = raw ?? null;
      const features = raw ? normalizeLandmarks(raw) : null;

      const rec = recordingRef.current;
      if (rec) {
        // While training, never type into the transcript.
        candidate = null;
        handleRecording(rec, features, now);
      } else {
        handleRecognition(features);
      }
    };

    (async () => {
      // 1. Camera
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
      } catch (err) {
        if (!cancelled) {
          setStatus("no-camera");
          setError(err instanceof Error ? err.message : "Camera unavailable.");
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }

      // 2. Hand model
      try {
        landmarker = await createHandLandmarker();
      } catch (err) {
        if (!cancelled) {
          setStatus("loading");
          setError(`Could not load the hand-tracking model: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (cancelled) {
        landmarker.close();
        return;
      }

      setStatus("ready");
      loop();
    })();

    // Cleanup on unmount: stop the loop, release the camera (turns the light off), free wasm memory.
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
      const video = videoRef.current;
      if (video) video.srcObject = null;
      // A recording interrupted by unmount would leave its promise hanging.
      recordingRef.current?.resolve(0);
      recordingRef.current = null;
    };
  }, [setSamples]);

  // ---- Public actions ----

  /**
   * Capture ~30 frames of the current sign under `label` (over ~1 second, after a short
   * get-ready pause). Resolves with the number of samples actually stored.
   */
  const addSamples = useCallback((label: string): Promise<number> => {
    const clean = label.trim();
    if (!clean || recordingRef.current) return Promise.resolve(0);
    return new Promise((resolve) => {
      const startedAt = performance.now() + GET_READY_MS;
      recordingRef.current = { label: clean, startedAt, lastCaptureAt: 0, captured: [], resolve };
      setRecordingPhase("get-ready");
    });
  }, []);

  const clearTranscript = useCallback(() => setTranscript(""), []);
  const addSpace = useCallback(() => setTranscript((t) => t + " "), []);
  const backspace = useCallback(() => setTranscript((t) => t.slice(0, -1)), []);

  const resetTraining = useCallback(() => setSamples([]), [setSamples]);

  /** The dataset as JSON text, ready to be saved to a file and shared. */
  const exportSamples = useCallback(() => JSON.stringify(samplesRef.current), []);

  /** Merge samples from JSON text into the dataset. Returns how many were added; throws on bad input. */
  const importSamples = useCallback(
    (json: string): number => {
      const incoming = parseSamples(json);
      setSamples([...samplesRef.current, ...incoming]);
      return incoming.length;
    },
    [setSamples],
  );

  return {
    videoRef,
    status,
    currentPrediction,
    transcript,
    samplesPerLabel,
    addSamples,
    clearTranscript,
    resetTraining,
    exportSamples,
    importSamples,
    // Extras beyond the agreed list (needed by the UI):
    addSpace,
    backspace,
    landmarksRef: landmarksRef as RefObject<Landmark[] | null>,
    recordingPhase,
    error,
  };
}
