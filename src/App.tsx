import { useRef, useState } from "react";
import SignToText from "./components/SignToText";
import SpeechToSign from "./components/SpeechToSign";
import SpeakButton from "./components/SpeakButton";
import { cleanTranscript } from "./lib/gemma";
import "./App.css";

type PanelId = "sign" | "speech";

export default function App() {
  const [panel, setPanel] = useState<PanelId>("sign");
  const [text, setText] = useState("");
  const [cleaned, setCleaned] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const textRef = useRef("");
  // Drops a Gemma reply that belongs to an older transcript.
  const requestId = useRef(0);

  function handleRecognized(next: string) {
    if (textRef.current === next) return;
    textRef.current = next;
    requestId.current += 1;
    setCleaning(false);
    setText(next);
    setCleaned("");
  }

  async function handleClean() {
    const source = text;
    const id = ++requestId.current;
    setCleaning(true);
    const next = await cleanTranscript(source);
    if (id !== requestId.current) return;
    setCleaned(next);
    setCleaning(false);
  }

  const sentence = cleaned.trim() ? cleaned : text;
  const canClean = text.trim().length > 0 && !cleaning;

  return (
    <div className="app">
      <header>
        <h1>SignBridge</h1>
        <p className="tagline">Turn signs into speech, and speech into signs.</p>
      </header>

      <div className="bridge-tabs" role="tablist" aria-label="Translation direction">
        <button
          type="button"
          role="tab"
          id="tab-sign"
          aria-selected={panel === "sign"}
          aria-controls="panel-sign"
          onClick={() => setPanel("sign")}
        >
          Sign → Text/Speech
        </button>
        <button
          type="button"
          role="tab"
          id="tab-speech"
          aria-selected={panel === "speech"}
          aria-controls="panel-speech"
          onClick={() => setPanel("speech")}
        >
          Speech → Sign
        </button>
      </div>

      <main className="two-panel">
        <div
          id="panel-sign"
          className={panel === "sign" ? "bridge-column is-active" : "bridge-column"}
        >
          <SignToText onText={handleRecognized} />
          <section className="panel" aria-labelledby="cleanup-title">
            <h2 id="cleanup-title">Sentence</h2>
            <div className="row">
              <button type="button" onClick={handleClean} disabled={!canClean}>
                {cleaning ? "Cleaning up…" : "Clean up with AI"}
              </button>
            </div>
            {cleaning ? (
              <p className="muted" role="status">
                Cleaning up the sentence…
              </p>
            ) : null}
            <h3>{cleaned.trim() ? "Cleaned sentence" : "Recognized text"}</h3>
            <p className="sentence" aria-live="polite">
              {sentence.trim() ? sentence : "Signs you make will show up here."}
            </p>
            <SpeakButton text={sentence} />
          </section>
        </div>

        <div
          id="panel-speech"
          className={panel === "speech" ? "bridge-column is-active" : "bridge-column"}
        >
          <SpeechToSign />
        </div>
      </main>
    </div>
  );
}
