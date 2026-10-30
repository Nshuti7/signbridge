import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { HandLandmarker } from "@mediapipe/tasks-vision";
import type { SignToTextProps } from "../types";
import { useSignRecognizer } from "../hooks/useSignRecognizer";

export default function SignToText({ onText }: SignToTextProps) {
  const {
    videoRef,
    landmarksRef,
    status,
    error,
    currentPrediction,
    transcript,
    samplesPerLabel,
    recordingPhase,
    addSamples,
    addSpace,
    backspace,
    clearTranscript,
    resetTraining,
    exportSamples,
    importSamples,
  } = useSignRecognizer();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");

  // Tell the parent about every transcript change (typing, space, backspace, clear).
  // Kept in an effect so it also covers changes made by the recognizer itself.
  // `onText` is read through a ref so a parent passing an inline function does not
  // re-trigger the effect (and spam the parent) on every render.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  useEffect(() => {
    onTextRef.current(transcript);
  }, [transcript]);

  // ---- Skeleton overlay ----
  // The recognizer writes landmarks to a ref ~30x/s. Drawing from our own animation
  // loop reads that ref directly, so the canvas never causes React re-renders.
  useEffect(() => {
    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.videoWidth === 0) return;

      // Match the canvas bitmap to the video's real pixels so lines line up exactly.
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const lm = landmarksRef.current;
      if (!lm) return;
      // Landmarks are normalized 0..1, so multiply by the canvas size.
      // No mirroring math here: CSS flips video AND canvas together (see .camera).
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#00e5ff";
      ctx.beginPath();
      for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
        ctx.moveTo(lm[start].x * canvas.width, lm[start].y * canvas.height);
        ctx.lineTo(lm[end].x * canvas.width, lm[end].y * canvas.height);
      }
      ctx.stroke();
      ctx.fillStyle = "#ffeb3b";
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(rafId);
  }, [videoRef, landmarksRef]);

  // ---- Training handlers ----
  const recording = recordingPhase !== "idle";

  const onRecord = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    if (!name || recording) return;
    setMessage(`Get ready to sign "${name}"...`);
    const count = await addSamples(name);
    setMessage(
      count > 0
        ? `Saved ${count} samples for "${name}".`
        : "No samples saved. Keep your hand in view while recording.",
    );
  };

  const onExport = () => {
    const blob = new Blob([exportSamples()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "samples.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file later
    if (!file) return;
    try {
      const added = importSamples(await file.text());
      setMessage(`Imported ${added} samples.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Import failed.");
    }
  };

  const onReset = () => {
    if (window.confirm("Delete ALL recorded samples? Export first if you want a backup.")) {
      resetTraining();
      setMessage("Training data cleared.");
    }
  };

  const labels = Object.entries(samplesPerLabel).sort(([a], [b]) => a.localeCompare(b));
  const percent = currentPrediction ? Math.round(currentPrediction.confidence * 100) : 0;

  return (
    <section className="panel" aria-labelledby="sign-title">
      <h2 id="sign-title">Sign to Text</h2>

      {/* ---- Camera ---- */}
      <div className="camera">
        {/* muted + playsInline are required for autoplay on mobile browsers */}
        <video ref={videoRef} muted playsInline aria-label="Webcam preview" />
        <canvas ref={canvasRef} aria-hidden="true" />
        {status !== "ready" && (
          <div className="camera-overlay" role="status">
            {status === "no-camera"
              ? "No camera available. Allow camera access and reload."
              : (error ?? "Loading hand tracking...")}
          </div>
        )}
      </div>

      {/* ---- Live label ---- */}
      <div className="live" aria-live="polite">
        <div className="live-label" aria-label="Detected sign">
          {currentPrediction ? currentPrediction.label : "—"}
        </div>
        <div
          className="bar"
          role="progressbar"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="muted">{percent}% confidence</div>
      </div>

      {/* ---- Transcript ---- */}
      <h3>Transcript</h3>
      <div className="transcript" role="textbox" aria-readonly="true" aria-label="Transcript">
        {transcript || <span className="muted">Signs you hold steady appear here.</span>}
      </div>
      <div className="row">
        <button type="button" onClick={addSpace}>
          Add space
        </button>
        <button type="button" onClick={backspace} disabled={!transcript}>
          Backspace
        </button>
        <button type="button" onClick={clearTranscript} disabled={!transcript}>
          Clear
        </button>
      </div>

      {/* ---- Training ---- */}
      <h3>Training</h3>
      <form className="row" onSubmit={onRecord}>
        <label htmlFor="sign-label" className="sr-only">
          Label for the sign
        </label>
        <input
          id="sign-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label, e.g. A"
          autoComplete="off"
        />
        <button type="submit" disabled={!label.trim() || recording || status !== "ready"}>
          {recordingPhase === "get-ready"
            ? "Get ready..."
            : recordingPhase === "recording"
              ? "Recording..."
              : "Record 30 samples"}
        </button>
      </form>
      <p className="muted" role="status">
        {message}
      </p>

      {labels.length === 0 ? (
        <p className="muted">No signs trained yet.</p>
      ) : (
        <ul className="labels" aria-label="Trained signs">
          {labels.map(([name, count]) => (
            <li key={name}>
              <strong>{name}</strong> <span className="muted">{count} samples</span>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button type="button" onClick={onExport} disabled={labels.length === 0}>
          Export JSON
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
        <button type="button" className="danger" onClick={onReset} disabled={labels.length === 0}>
          Reset training
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onImportFile}
          hidden
        />
      </div>
    </section>
  );
}
