# SignBridge

Open-source, in-browser bridge between sign language and text/speech. Hand tracking runs
locally with MediaPipe; recognition is a tiny KNN classifier you train yourself.

License: MIT.

## Setup

Requires Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev        # http://localhost:5173 (camera needs localhost or https)
pnpm build      # type-check + production build
```

Offline use: `public/hand_landmarker.task` is committed to the repo, so the model loads from
your own server. The MediaPipe **wasm** runtime still comes from the jsdelivr CDN on first load
(the browser then caches it). If the model file is ever missing, download it with:

```bash
curl -L -o public/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

## How to train signs

1. Start the app and allow camera access.
2. Type a label (e.g. `A`) in the Training box and press **Record 30 samples**.
3. After a 1.5 s "get ready" pause, hold the sign steady in view. About 30 frames are captured
   over roughly one second.
4. Repeat 2-3 times per sign, moving your hand slightly (closer, further, small tilts) for a
   sturdier model. Samples add up under the same label.
5. Sign normally: when a sign is held for ~10 frames with >60% confidence, its label is added
   to the transcript. To type a double letter ("LL"), take your hand out of view or show a
   different sign in between.

Up to **two hands** are tracked. Train a sign with the same hands in view that you will use when
signing: a one-handed sign is recorded with one hand visible, a two-handed sign with both (their
relative position is part of the sign). The camera preview is mirrored for comfort, but features
are computed on the unmirrored image.

### Sharing a dataset

- **Export JSON** downloads `samples.json`; **Import JSON** merges a file into your data.
- To ship a dataset with the app, put the file at `public/samples.json`. It is loaded on first run
  only (when localStorage has no saved samples). Samples are otherwise persisted in localStorage.

### Tuning

Constants live at the top of `src/hooks/useSignRecognizer.ts` (stability frames, confidence) and
`src/lib/knn.ts` (`K`, `UNKNOWN_DISTANCE`: raise it if known signs show as "—").

## Folder ownership

To avoid merge conflicts, only edit files you own. Change `src/types.ts` by team agreement.

| Path                                 | Owner        | Notes                              |
| ------------------------------------ | ------------ | ---------------------------------- |
| `src/types.ts`                       | Sign engine  | Shared contracts                   |
| `src/lib/normalize.ts`               | Sign engine  | Landmark normalization             |
| `src/lib/knn.ts`                     | Sign engine  | KNN classifier                     |
| `src/lib/handLandmarker.ts`          | Sign engine  | MediaPipe setup                    |
| `src/hooks/useSignRecognizer.ts`     | Sign engine  | Main hook                          |
| `src/components/SignToText.tsx`      | Sign engine  | Camera + training UI               |
| `src/components/SpeechToSign.tsx`   | Teammate B   | Speech recognition and ASL letter cards |
| `src/lib/gemma.ts`                   | Teammate C   | Stub: `cleanTranscript(raw)`       |
| `src/App.tsx`                        | Teammate C   | Two-panel shell, finalized by C    |
| `src/index.css`, `src/main.tsx`      | Shared       | Coordinate before editing          |

## Contracts

```ts
type Landmark = { x: number; y: number; z: number };
type Sample = { label: string; features: number[] }; // 129 numbers: left 63 + right 63 + wrist offset 3
type Prediction = { label: string; confidence: number };
// <SignToText onText={(text: string) => void} />
// cleanTranscript(raw: string): Promise<string>
// <SpeechToSign /> (default export, no props; browser speech recognition is optional)
```
