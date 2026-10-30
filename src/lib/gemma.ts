/**
 * Normalize spacing and sentence casing without changing the words or guessing
 * at sign-language grammar. This is a local formatter, not an AI translation.
 */
export async function cleanTranscript(raw: string): Promise<string> {
  const text = raw.replace(/\s+/g, " ").trim().replace(/\s+([,;:.!?])/g, "$1");
  if (!text) return "";

  const formatted = text.toLocaleLowerCase().replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`,
  );

  return /[.!?]$/.test(formatted) ? formatted : `${formatted}.`;
}
