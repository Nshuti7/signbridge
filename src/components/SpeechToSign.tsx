import React, { useState, useEffect, useRef } from 'react';
import { aslAlphabet, isSignable } from '../lib/aslAlphabet';

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
  const [isSupported, setIsSupported] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [processedText, setProcessedText] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [manualInput, setManualInput] = useState('');
  
  // Playback state
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(500);
  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  // 1. Simplification Logic
  // Teammate C will eventually replace this local constant with an import from ../lib/gemma
  const simplify = async (t: string) => {
    try {
      // Future: import { simplifyForSign } from "../lib/gemma";
      // return await simplifyForSign(t);
      return t; // Fallback / Current implementation
    } catch (e) {
      console.error("Simplification error, using original text", e);
      return t;
    }
  };

  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    setIsSupported(true);

    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      // We keep the transcript live, but we only "finalize" for signing when user stops or pauses
      setTranscript(finalTranscript || interimTranscript);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
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
      recognition?.stop();
      setIsListening(false);
      // Once stopped, we "simplify" the final result for signing
      const simplified = await simplify(transcript);
      setProcessedText(simplified);
    } else {
      setTranscript('');
      setProcessedText('');
      setPlaybackIndex(-1);
      setIsPlaying(false);
      if (!recognition) return;
      recognition?.start();
      setIsListening(true);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const simplified = await simplify(manualInput);
    setProcessedText(simplified);
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
      <div key={wordIdx} className="flex gap-2 mx-4 mb-4">
        {word.split('').map((char, charIdx) => {
          // Calculate global index for highlighting
          const globalIdx = words.slice(0, wordIdx).join(' ').length + charIdx;
          const isHighlighted = playbackIndex === globalIdx;
          
          if (!isSignable(char)) return <span key={charIdx} className="text-gray-300">?</span>;

          return (
            <div 
              key={charIdx}
              className={`w-16 h-16 sm:w-20 sm:h-20 border-4 rounded-xl transition-all duration-200 flex items-center justify-center bg-white
                ${isHighlighted ? 'border-blue-500 scale-110 shadow-lg ring-4 ring-blue-200' : 'border-gray-200 opacity-60'}`}
            >
              <img 
                src={aslAlphabet[char]} 
                alt={`ASL sign for ${char}`} 
                className="w-full h-full object-contain p-1"
                onError={(e) => {
                  // Fallback if SVG is missing
                  (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="10" fill="%23eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="40" fill="%23999">${char}</text></svg>`;
                }}
              />
            </div>
          );
        })}
      </div>
    ));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto flex flex-col gap-8">
      {!isSupported && (
        <div className="p-4 bg-amber-100 text-amber-800 rounded-lg border border-amber-300" role="alert">
          Your browser does not support Speech Recognition. Please use Chrome or Edge, or use the manual input below.
        </div>
      )}

      {/* Controls Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-4 p-4 border rounded-xl shadow-sm bg-white">
          <h2 className="text-xl font-bold">Voice Input</h2>
          <div className="flex gap-2">
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              className="p-2 border rounded"
              aria-label="Select language"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="sw">Swahili</option>
            </select>
            <button 
              onClick={toggleListening}
              aria-label={isListening ? "Stop listening" : "Start listening"}
              className={`flex-1 py-2 px-4 rounded-lg font-bold text-white transition-all ${
                isListening ? 'bg-red-500 animate-pulse' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isListening ? '🛑 Stop Listening' : '🎤 Start Listening'}
            </button>
          </div>
          <p className="text-sm text-gray-600 italic h-8">
            {isListening ? `Listening... ${transcript}` : 'Click the mic to speak.'}
          </p>
        </div>

        <div className="flex flex-col gap-4 p-4 border rounded-xl shadow-sm bg-white">
          <h2 className="text-xl font-bold">Manual Input</h2>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input 
              type="text" 
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Type text here..."
              className="flex-1 p-2 border rounded"
              aria-label="Manual text input"
            />
            <button 
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              Convert
            </button>
          </form>
        </div>
      </div>

      {/* Playback Controls */}
      {processedText && (
        <div className="flex flex-wrap items-center gap-6 p-4 bg-gray-100 rounded-xl justify-center">
          <div className="flex gap-2">
            <button 
              onClick={() => { setPlaybackIndex(-1); setIsPlaying(false); }}
              className="p-3 bg-white border rounded-lg hover:bg-gray-50"
              aria-label="Replay"
            >
              🔄 Replay
            </button>
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 min-w-[100px]"
              aria-label={isPlaying ? "Pause playback" : "Play playback"}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Speed:</label>
            <input 
              type="range" min="100" max="1000" step="100" 
              value={playbackSpeed} 
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="w-32"
              aria-label="Adjust playback speed"
            />
            <span className="text-xs text-gray-500">{playbackSpeed}ms</span>
          </div>
        </div>
      )}

      {/* Visual Output */}
      <div className="flex flex-wrap content-start justify-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300 min-h-[300px]">
        {processedText ? renderCards() : (
          <div className="text-gray-400 flex flex-col items-center gap-2">
            <span className="text-5xl">✋</span>
            <p>Your ASL cards will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpeechToSign;
