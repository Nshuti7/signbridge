// Transcript cleanup. Tries Gemma through the Gemini API; falls back to a local formatter
// whenever there is no key, the call is slow, or the answer looks wrong.

const API_KEY = import.meta.env.VITE_GEMMA_API_KEY as string | undefined;
const MODEL = "gemma-4-26b-a4b-it";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Measured: a call usually takes a few seconds but can stall or return a 500. Never let
// the UI wait longer than this; the local formatter result is shown instead.
const TIMEOUT_MS = 10_000;

const PROMPT = `You clean up raw transcripts produced by a sign-language fingerspelling recognizer.
The text often has no spaces, so split run-together letters into the most likely English words
(for example "HELLOWORLD" becomes "Hello World"). Also fix casing, punctuation, stray extra letters
and obvious misread letters (for example "thHELLOWORLD" becomes "Hello World").
Do not invent extra words or translate. Reply with ONLY the cleaned text.

Raw transcript:
`;

/**
 * Local fallback: normalize spacing and sentence casing without changing the words or
 * guessing at sign-language grammar. Not an AI translation.
 */
export function formatLocally(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim().replace(/\s+([,;:.!?])/g, "$1");
  if (!text) return "";

  const formatted = text.toLocaleLowerCase().replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`,
  );

  return /[.!?]$/.test(formatted) ? formatted : `${formatted}.`;
}

// Same transcript -> same answer, so repeated clicks do not spend API calls.
const cache = new Map<string, string>();

async function askGemma(raw: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT + raw }] }],
        // This model "thinks" before answering and thinking tokens count against the limit
        // (a short answer needed ~1,700 in testing), so keep plenty of headroom.
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });
    if (!res.ok) throw new Error(`Gemma request failed: HTTP ${res.status}`);

    const data = await res.json();
    const parts: { text?: string; thought?: boolean }[] = data.candidates?.[0]?.content?.parts ?? [];
    // Skip the model's reasoning ("thought") parts; keep only the final answer.
    return parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("")
      .trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Clean up a raw sign-to-text transcript. Never throws: on any problem it returns the local format. */
export async function cleanTranscript(raw: string): Promise<string> {
  const fallback = formatLocally(raw);
  if (!fallback || !API_KEY) return fallback;

  const cached = cache.get(raw);
  if (cached) return cached;

  try {
    const cleaned = await askGemma(raw);
    // Guard against a runaway or empty answer: cleanup should never be much longer than the input.
    if (!cleaned || cleaned.length > raw.length * 2 + 20) return fallback;
    cache.set(raw, cleaned);
    return cleaned;
  } catch (err) {
    console.warn("Gemma cleanup failed, using local formatting:", err);
    return fallback;
  }
}
