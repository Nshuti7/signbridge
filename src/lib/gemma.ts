/**
 * Gemma text cleanup for SignBridge.
 *
 * VITE_ variables are inlined into the JavaScript bundle. Anyone who opens
 * the app in a browser can read VITE_GEMMA_API_KEY. That is acceptable for a
 * local demo. For production, move this request behind a serverless proxy
 * that holds the key on the server and returns only the model text.
 *
 * Endpoint: there is no hackathon-specific URL in this repo. Calls go to the
 * public Generative Language API documented by Google:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * The model id stays configurable because Google retires ids over time.
 * The assignment default is gemma-3-27b-it.
 */

const DEFAULT_MODEL = "gemma-3-27b-it";
const TIMEOUT_MS = 8000;
const GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const CLEAN_INSTRUCTION =
  'The input is noisy letters/words produced by a sign-language recogniser (e.g. "H E L O W O R L D"). Fix spacing and spelling and return ONLY the corrected sentence, no explanations.';

const SIMPLIFY_INSTRUCTION =
  "Rewrite the text as short, simple sentences that are easy to sign. Keep the meaning. Return ONLY the rewritten text.";

type GemmaEnv = {
  VITE_GEMMA_API_KEY?: string;
  VITE_GEMMA_MODEL?: string;
};

type GemmaResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

function readConfig(): { apiKey: string; model: string } {
  // Vite's ImportMetaEnv does not list our keys. Cast so this file can read
  // them without editing the shared env declaration.
  const env = import.meta.env as GemmaEnv;
  const apiKey = env.VITE_GEMMA_API_KEY?.trim() ?? "";
  const requested = env.VITE_GEMMA_MODEL?.trim() || DEFAULT_MODEL;
  // Accept either "gemma-3-27b-it" or "models/gemma-3-27b-it".
  const model = requested.replace(/^models\//, "");
  return { apiKey, model };
}

function buildPrompt(instruction: string, input: string): string {
  return `${instruction}\n\nInput:\n${input}`;
}

/**
 * One generateContent call. Any failure returns `fallback` so the recogniser
 * and the speech UI keep working when the key, network, or model is down.
 */
async function generate(instruction: string, input: string): Promise<string> {
  const fallback = input;
  if (!input.trim()) return fallback;

  const { apiKey, model } = readConfig();
  if (!apiKey) {
    console.warn(
      "SignBridge: VITE_GEMMA_API_KEY is missing. Returning the original text.",
    );
    return fallback;
  }

  try {
    // Only `contents` is sent. Gemma rejects some Gemini-only fields, and a
    // 400 would hide the original text behind an error the user cannot fix.
    const response = await fetch(
      `${GENERATE_URL}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Header rather than ?key= so the key is not written into the URL.
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(instruction, input) }] }],
        }),
        // AbortSignal.timeout rejects if Gemma has not answered in 8 seconds,
        // so a hung request cannot leave the button spinning.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as GemmaResponse;
        if (body.error?.message) detail = ` ${body.error.message}`;
      } catch {
        detail = "";
      }
      console.warn(
        `SignBridge: Gemma request failed (${response.status}).${detail} Returning the original text.`,
      );
      return fallback;
    }

    const data = (await response.json()) as GemmaResponse;
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    if (!text) {
      console.warn(
        "SignBridge: Gemma returned no text. Returning the original text.",
      );
      return fallback;
    }
    return text;
  } catch (error) {
    console.warn(
      "SignBridge: Gemma call failed. Returning the original text.",
      error,
    );
    return fallback;
  }
}

/** Fix spacing and spelling from the sign recogniser. Matches CleanTranscript in types.ts. */
export function cleanTranscript(raw: string): Promise<string> {
  return generate(CLEAN_INSTRUCTION, raw);
}

/** Short sentences that are easier to sign, same meaning. */
export function simplifyForSign(text: string): Promise<string> {
  return generate(SIMPLIFY_INSTRUCTION, text);
}
