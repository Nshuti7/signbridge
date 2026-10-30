import React, { useState, useEffect } from 'react';

interface SpeakButtonProps {
  text: string;
}

const SpeakButton: React.FC<SpeakButtonProps> = ({ text }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceIndex, setVoiceIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };
    
    loadVoices();
    // voiceschanged event is necessary because getVoices() is async in Chrome
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const handleSpeak = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voices[voiceIndex];
    utterance.rate = rate;
    
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="flex flex-col gap-4 p-4 border rounded-lg bg-gray-50 max-w-sm">
      <div className="flex flex-col gap-2">
        <label htmlFor="voice-select" className="text-sm font-medium">Voice</label>
        <select 
          id="voice-select"
          className="p-2 border rounded bg-white"
          value={voiceIndex}
          onChange={(e) => setVoiceIndex(Number(e.target.value))}
        >
          {voices.map((voice, index) => (
            <option key={voice.name} value={index}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="speed-slider" className="text-sm font-medium">
          Speed: {rate}x
        </label>
        <input 
          id="speed-slider"
          type="range" 
          min="0.5" 
          max="2" 
          step="0.1" 
          value={rate} 
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      <button
        onClick={handleSpeak}
        disabled={!text}
        aria-label={isSpeaking ? "Stop speaking" : "Speak text aloud"}
        className={`py-3 px-6 rounded-full font-bold text-white transition-colors ${
          !text ? 'bg-gray-400 cursor-not-allowed' : 
          isSpeaking ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isSpeaking ? 'Stop' : 'Speak'}
      </button>
    </div>
  );
};

export default SpeakButton;