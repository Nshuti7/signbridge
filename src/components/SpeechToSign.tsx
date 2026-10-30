import React, { useState, useEffect, useRef } from 'react';
import { aslAlphabet, isSignable } from '../lib/aslAlphabet';
import { cleanTranscript } from '../lib/gemma';

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const SpeechToSign: React.FC = () => {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptRef = useRef('');
  const shouldProcessSpeechRef = useRef(false);
  const [isSupported, setIsSupported] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [speechStatus, setSpeechStatus] = useState('Click the mic to speak.');
  const [processedText, setProcessedText] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [manualInput, setManualInput] = useState('');
  
  // Playback state
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(500);
  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    setIsSupported(true);

    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let fullTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        const result = event.results[i];
        fullTranscript += `${result[0].transcript} `;
      }
      const currentTranscript = fullTranscript.trim();
      transcriptRef.current = currentTranscript;
      setTranscript(currentTranscript);
    };

    recognition.onerror = (event) => {
      shouldProcessSpeechRef.current = false;
      setSpeechStatus(
        event.error === 'network'
          ? 'Speech recognition needs a network connection. You can type text below instead.'
          : `Speech recognition error: ${event.error}. You can type text below instead.`,
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!shouldProcessSpeechRef.current) return;
      shouldProcessSpeechRef.current = false;
      void cleanTranscript(transcriptRef.current).then(setProcessedText);
    };

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = language;
  }, [language]);

  const toggleListening = async () => {
    const recognition = recognitionRef.current;
    if (isListening) {
      shouldProcessSpeechRef.current = true;
      recognition?.stop();
      setIsListening(false);
    } else {
      if (!recognition) return;
      setTranscript('');
      transcriptRef.current = '';
      setProcessedText('');
      setPlaybackIndex(-1);
      setIsPlaying(false);
      setSpeechStatus('Listening...');
      shouldProcessSpeechRef.current = false;
      try {
        recognition.start();
        setIsListening(true);
      } catch (error) {
        setSpeechStatus(
          error instanceof Error ? error.message : 'Could not start speech recognition.',
        );
      }
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessedText(await cleanTranscript(manualInput));
    setPlaybackIndex(-1);
    setIsPlaying(false);
  };

  // 2. Playback Logic
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setPlaybackIndex((prev) => {
          const words = processedText.toUpperCase().split(' ');
          const totalChars = words.join(' ').length;
          if (prev >= totalChars - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeed);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, playbackSpeed, processedText]);

  // 3. Rendering Helper
  const renderCards = () => {
    const words = processedText.toUpperCase().split(' ');
    
    return words.map((word, wordIdx) => (
      <div key={wordIdx} className="speech-word">
        {word.split('').map((char, charIdx) => {
          // Calculate global index for highlighting
          const globalIdx = words.slice(0, wordIdx).join(' ').length + charIdx;
          const isHighlighted = playbackIndex === globalIdx;
          
          if (!isSignable(char)) return null;

          return (
            <div 
              key={charIdx}
              className={`speech-card${isHighlighted ? ' is-highlighted' : ''}`}
            >
              <img 
                src={aslAlphabet[char]} 
                alt={`ASL sign for ${char}`} 
                className="speech-card-image"
                onError={(e) => e.currentTarget.parentElement?.classList.add('is-placeholder')}
              />
              <span className="speech-card-placeholder" aria-hidden="true">{char}</span>
            </div>
          );
        })}
      </div>
    ));
  };

  return (
    <section className="panel speech-panel" aria-labelledby="speech-title">
      {!isSupported && (
        <div className="speech-alert" role="alert">
          Your browser does not support Speech Recognition. Please use Chrome or Edge, or use the manual input below.
        </div>
      )}

      <div className="speech-controls">
        <div className="speech-control-group">
          <h2 id="speech-title">Speech to Sign</h2>
          <div className="speech-control-row">
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Select language"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="sw">Swahili</option>
            </select>
            <button 
              onClick={toggleListening}
              type="button"
              aria-label={isListening ? "Stop listening" : "Start listening"}
              className={isListening ? 'danger' : ''}
            >
              {isListening ? '🛑 Stop Listening' : '🎤 Start Listening'}
            </button>
          </div>
          <p className="muted speech-status" role="status">
            {isListening && transcript ? `${speechStatus} ${transcript}` : speechStatus}
          </p>
        </div>

        <div className="speech-control-group">
          <h3>Manual Input</h3>
          <form onSubmit={handleManualSubmit} className="speech-control-row">
            <input 
              type="text" 
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Type text here..."
              aria-label="Manual text input"
            />
            <button type="submit">
              Convert
            </button>
          </form>
        </div>
      </div>

      {/* Playback Controls */}
      {processedText && (
        <>
          <div className="speech-playback">
            <button 
              onClick={() => { setPlaybackIndex(-1); setIsPlaying(false); }}
              aria-label="Replay"
            >
              🔄 Replay
            </button>
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? "Pause playback" : "Play playback"}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
          </div>
          
          <div className="speech-speed">
            <label htmlFor="playback-speed">Playback speed</label>
            <input 
              id="playback-speed"
              type="range" min="100" max="1000" step="100" 
              value={playbackSpeed} 
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              aria-label="Adjust playback speed"
            />
            <span className="muted">{playbackSpeed} ms per letter</span>
          </div>

          <div className="speech-output">
            <h3>Readable text</h3>
            <p className="speech-readable-text">{processedText}</p>
            <h3>Spell it letter by letter</h3>
            <div className="speech-cards" aria-label="ASL fingerspelling cards">
              {renderCards()}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default SpeechToSign;
