# Contributing to SignBridge

SignBridge runs hand tracking in the browser and turns recognised signs into
text. Gemma can clean that text into a sentence. Please edit only the files
you own (see the table in the README) so teammates are not rewriting the same
lines.

## Add a sign

Training lives in the sign-to-text panel (`src/components/SignToText.tsx`).

1. Start the app and allow camera access (`pnpm dev`).
2. Type a label, for example `A` or `HELLO`, and press **Record 30 samples**.
3. After the short "get ready" pause, hold the sign steady. Repeat 2–3 times per sign, shifting distance and tilt a little.
4. Use the same number of hands while training that you will use when signing. One-handed signs are recorded with one hand in view. Two-handed signs need both hands in view.
5. Sign normally. A label held steady with enough confidence is appended to the transcript.
6. Press **Clean up with AI**. Spaced letters should come back as a sentence. If the key is missing or Gemma fails, a locally formatted version of the transcript must still appear.

Do not commit camera recordings of someone's face. Export a dataset with **Export JSON** if you want to share samples, and do not put API keys in that file.

## Pull request checklist

- [ ] `pnpm build` succeeds.
- [ ] No `.env` file, API key, or face recording is included.
- [ ] A new sign was recorded with **Record 30 samples** and tried in Sign → Text/Speech.
- [ ] The screen is still readable on a phone-width window.
- [ ] If Gemma fails, the app still shows readable text.
- [ ] You did not edit another teammate's files unless the change was agreed.
- [ ] `src/index.css` and `src/main.tsx` were left alone unless the team agreed. Shell-only styles belong in `src/App.css`.
