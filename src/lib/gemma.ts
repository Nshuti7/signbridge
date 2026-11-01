/**
 * Gemma text cleanup for SignBridge.
 *
 * VITE_ variables are inlined into the JavaScript bundle. Anyone who opens the app in a
 * browser can read VITE_GEMMA_API_KEY. That is acceptable for a local demo. For production,
 * move this request behind a serverless proxy that holds the key on the server.
 *
 * Calls go to the public Generative Language API:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * The model id is configurable (VITE_GEMMA_MODEL) because Google retires ids over time.
 * Gemma ids available on our key: gemma-4-26b-a4b-it (default), gemma-4-31b-it.
 *
 * Every call fails open: with no key, a slow or failing API, or a suspicious answer, the
 * caller still gets usable text and never an exception.
 */

const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
const GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Measured: a call usually takes a few seconds but can stall or return a 500. Never let
// the UI wait longer than this.
const TIMEOUT_MS = 10_000;

const CLEAN_INSTRUCTION = `You clean up raw transcripts produced by a sign-language fingerspelling recognizer.
The text often has no spaces, so split run-together letters into the most likely English words
(for example "HELLOWORLD" becomes "Hello World"). Also fix casing, punctuation, stray extra letters
and obvious misread letters (for example "thHELLOWORLD" becomes "Hello World").
Do not invent extra words or translate. Reply with ONLY the cleaned text.`;

const SIMPLIFY_INSTRUCTION =
  "Rewrite the text as short, simple sentences that are easy to sign. Keep the meaning. Return ONLY the rewritten text.";

type GemmaEnv = { VITE_GEMMA_API_KEY?: string; VITE_GEMMA_MODEL?: string };

type GemmaResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  error?: { message?: string };
};

function readConfig(): { apiKey: string; model: string } {
  // Vite's ImportMetaEnv does not list our keys, so cast instead of editing the shared declaration.
  const env = import.meta.env as GemmaEnv;
  const apiKey = env.VITE_GEMMA_API_KEY?.trim() ?? "";
  // Accept either "gemma-4-26b-a4b-it" or "models/gemma-4-26b-a4b-it".
  const model = (env.VITE_GEMMA_MODEL?.trim() || DEFAULT_MODEL).replace(/^models\//, "");
  return { apiKey, model };
}

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

/** One generateContent call. Returns the model's answer text; throws on any failure. */
async function askGemma(instruction: string, input: string): Promise<string> {
  const { apiKey, model } = readConfig();
  const response = await fetch(`${GENERATE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Header rather than ?key= so the key is not written into the URL.
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${instruction}\n\nRaw transcript:\n${input}` }] }],
      // Gemma 4 "thinks" before answering and thinking tokens count against the limit
      // (a short answer needed ~1,700 in testing), so keep plenty of headroom.
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }),
    // Rejects if Gemma has not answered in time, so a hung request cannot leave a button spinning.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as GemmaResponse;
      if (body.error?.message) detail = ` ${body.error.message}`;
    } catch {
      /* no readable error body */
    }
    throw new Error(`Gemma request failed (${response.status}).${detail}`);
  }

  const data = (await response.json()) as GemmaResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  // Skip the model's reasoning ("thought") parts; keep only the final answer.
  return parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();
}

// Same input -> same answer, so repeated clicks do not spend API calls.
const cache = new Map<string, string>();

async function generate(instruction: string, input: string, fallback: string): Promise<string> {
  if (!input.trim()) return fallback;
  if (!readConfig().apiKey) {
    console.warn("SignBridge: VITE_GEMMA_API_KEY is missing. Using the local fallback.");
    return fallback;
  }

  const cacheKey = `${instruction}\u0000${input}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const answer = await askGemma(instruction, input);
    // Guard against a runaway or empty answer: a rewrite should never be much longer than the input.
    if (!answer || answer.length > input.length * 2 + 20) return fallback;
    cache.set(cacheKey, answer);
    return answer;
  } catch (err) {
    console.warn("SignBridge: Gemma call failed. Using the local fallback.", err);
    return fallback;
  }
}

/** Fix spacing and spelling from the sign recognizer. Matches CleanTranscript in types.ts. */
export function cleanTranscript(raw: string): Promise<string> {
  return generate(CLEAN_INSTRUCTION, raw, formatLocally(raw));
}

/** Short sentences that are easier to sign, same meaning. Falls back to the unchanged text. */
export function simplifyForSign(text: string): Promise<string> {
  return generate(SIMPLIFY_INSTRUCTION, text, text);
}
