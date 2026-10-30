// OWNER: teammate C finalizes this file. This is a simple two-panel shell.
import { useState } from "react";
import SignToText from "./components/SignToText";
import SpeechToSign from "./components/SpeechToSign";

export default function App() {
  // Text produced by the sign-to-text engine. Teammate C can pass it through
  // cleanTranscript() from ./lib/gemma before showing it.
  const [, setText] = useState("");

  return (
    <div className="app">
      <header>
        <h1>SignBridge</h1>
      </header>
      <main className="two-panel">
        <SignToText onText={setText} />
        <SpeechToSign />
      </main>
    </div>
  );
}
