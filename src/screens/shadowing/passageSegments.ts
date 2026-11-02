// Cuts a passage into sentences or phrases that can be played on their own.
// The text says where sentences and phrases end; the audio says where the
// voice actually pauses. A boundary is used only where both agree, so a clip
// never starts or stops in the middle of a word.

// With its extension, so that Node's test runner can load it too.
import { splitPieces, spokenLength, type Piece, type PieceEnd } from "./passageText.ts";

/** A stretch of a passage's audio, in seconds. */
export interface Clip {
  start: number;
  end: number;
}

/** A pause in a passage's audio, in seconds. */
export type Pause = Clip;

/** What was measured in a passage's audio. */
export interface PassageTiming {
  duration: number;
  /** Every pause, in order, including any at the very start or end. */
  pauses: Pause[];
}

/** How finely a passage is cut: at sentence ends, or also at commas, semicolons and dashes. */
export type SegmentUnit = "sentence" | "phrase";

/** One sentence or phrase of a passage. */
export interface Segment {
  /** Where its text is: `text.slice(from, to)`, without the space after it. */
  from: number;
  to: number;
  clip: Clip;
}

/**
 * Frames quieter than this, relative to the voice's usual loudness, are a
 * pause. It takes in the soft end of the breath some voices draw between
 * sentences; a stricter threshold heard only a sliver of silence there.
 */
const PAUSE_DB = -35;
const FRAME_SECONDS = 0.01;

/**
 * A pause lasts at least as long as saying this many letters; shorter
 * silences are the closures inside words like "act". Measured in letters
 * rather than seconds so that it holds for fast and slow voices alike.
 */
const MIN_PAUSE_LETTERS = 2.5;

/**
 * How far a stretch of speech may run from the length its letters predict
 * before a cut there is doubted: a share of that length, plus a few letters'
 * worth for how a voice starts and ends. Voices keep a steady pace, so the
 * share is small.
 */
const LENGTH_TOLERANCE = 0.12;
const TOLERANCE_LETTERS = 6;

/**
 * How much a longer pause is preferred over a shorter one in the same place.
 * Voices pause longer at the end of a sentence than at a comma, so that is
 * where length counts most.
 */
const SENTENCE_PAUSE_BONUS = 1.5;
const PHRASE_PAUSE_BONUS = 0.5;

/**
 * Leaving a boundary out, so that two pieces play as one. That is the safe
 * mistake: a cut in the wrong place sets the sound against the wrong text.
 * Voices often run straight through a comma, so leaving one out costs less.
 */
const SENTENCE_DROP_COST = 2;
const PHRASE_DROP_COST = 1;

/** The most pieces one clip can join; it bounds the search. */
const MAX_JOINED_PIECES = 8;

/** Silence kept at each side of a cut, so that soft first and last sounds are not lost. */
const CUT_PADDING_SECONDS = 0.12;

/**
 * Splits the passage into sentences or phrases and finds each one in the
 * audio. Where the voice does not pause at a boundary, the pieces on either
 * side stay together. A passage without any usable pause is one segment.
 */
export function segmentPassage(text: string, timing: PassageTiming, unit: SegmentUnit): Segment[] {
  const pieces = splitPieces(text);
  const cuts = alignCuts(text, pieces, spokenPauses(text, timing));
  // One alignment serves both units, so a sentence ends at the same place in either.
  const playableEnds: PieceEnd[] = unit === "phrase" ? ["sentence", "phrase"] : ["sentence"];
  const usableCuts = cuts.map((cut, index) => (playableEnds.includes(pieces[index].end) ? cut : null));
  return joinAtCuts(pieces, usableCuts, { start: 0, end: timing.duration });
}

// -- Audio -------------------------------------------------------------------

/**
 * Finds the pauses in mono audio samples. Loudness is measured against the
 * voice's usual level rather than the loudest moment, so one loud syllable
 * does not turn quiet speech into a pause.
 */
export function findPauses(samples: Float32Array, sampleRate: number): Pause[] {
  const frameLength = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frameCount = Math.floor(samples.length / frameLength);
  const levels = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let i = frame * frameLength; i < (frame + 1) * frameLength; i++) sum += samples[i] ** 2;
    levels[frame] = Math.sqrt(sum / frameLength);
  }
  const voiceLevel = percentile(levels, 0.95);
  if (voiceLevel === 0) return [];
  const threshold = voiceLevel * 10 ** (PAUSE_DB / 20);

  const frameSeconds = frameLength / sampleRate;
  const pauses: Pause[] = [];
  let quietFrom: number | null = null;
  for (let frame = 0; frame <= frameCount; frame++) {
    const isQuiet = frame < frameCount && levels[frame] < threshold;
    if (isQuiet && quietFrom === null) quietFrom = frame;
    if (!isQuiet && quietFrom !== null) {
      pauses.push({ start: quietFrom * frameSeconds, end: frame * frameSeconds });
      quietFrom = null;
    }
  }
  return pauses;
}

function percentile(values: Float64Array, share: number): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

// -- Matching text to audio ----------------------------------------------------

/** The pauses of a passage, and how long its speech takes without them. */
interface SpokenPauses {
  /** Pauses long enough to cut at, between the first sound and the last. */
  list: Pause[];
  /** For each of `list`, the seconds of speech before it, leaving out every pause. */
  speechBefore: number[];
  totalSpeech: number;
  lettersPerSecond: number;
  /** The shortest pause that counts, judged by how fast the passage is spoken. */
  minSeconds: number;
}

function spokenPauses(text: string, { duration, pauses }: PassageTiming): SpokenPauses {
  const leading = pauses.find((pause) => pause.start <= 0);
  const trailing = pauses.find((pause) => pause.end >= duration - FRAME_SECONDS);
  const speech = { start: leading?.end ?? 0, end: trailing?.start ?? duration };
  const inner = pauses.filter((pause) => pause.start > speech.start && pause.end < speech.end);

  const silence = inner.reduce((sum, pause) => sum + pause.end - pause.start, 0);
  const totalSpeech = speech.end - speech.start - silence;
  const lettersPerSecond = spokenLength(text) / totalSpeech;
  const minSeconds = MIN_PAUSE_LETTERS / lettersPerSecond;
  const spoken: SpokenPauses = { list: [], speechBefore: [], totalSpeech, lettersPerSecond, minSeconds };
  if (!Number.isFinite(lettersPerSecond) || lettersPerSecond <= 0) return spoken;

  let silenceBefore = 0;
  for (const pause of inner) {
    if (pause.end - pause.start >= minSeconds) {
      spoken.list.push(pause);
      spoken.speechBefore.push(pause.start - speech.start - silenceBefore);
    }
    silenceBefore += pause.end - pause.start;
  }
  return spoken;
}

/**
 * For each boundary between consecutive pieces, the pause where it is spoken,
 * or null where none fits.
 *
 * Every piece should take about as long as its letters at the passage's own
 * pace. The cuts are chosen together so that the pieces come closest to that,
 * each measured from the cut before it rather than from the start: over a
 * long passage, small differences in pace add up to whole sentences. Every
 * comma takes part, so that its pause is not mistaken for a sentence end.
 */
function alignCuts(text: string, pieces: Piece[], pauses: SpokenPauses): (Pause | null)[] {
  const boundaryCount = Math.max(0, pieces.length - 1);
  if (boundaryCount === 0 || pauses.list.length === 0) return new Array(boundaryCount).fill(null);
  return cheapestCuts(boundaryCount, pauses, cutCosts(text, pieces, pauses));
}

/** What each choice costs; the alignment adds them up and takes the cheapest. */
interface CutCosts {
  /** A clip from the cut at boundary `from` (-1: the start) to the cut at `to`, of `seconds` of speech. */
  clip(from: number, to: number, seconds: number): number;
  /** Cutting at `boundary` on `pause`, which pays back more the longer the pause. */
  cut(boundary: number, pause: number): number;
}

function cutCosts(text: string, pieces: Piece[], pauses: SpokenPauses): CutCosts {
  const { list, lettersPerSecond, minSeconds } = pauses;
  const expectedBefore = runningTotals(
    pieces.map((piece) => spokenLength(text.slice(piece.from, piece.to)) / lettersPerSecond),
  );
  const dropBefore = runningTotals(
    pieces.slice(0, -1).map((piece) => (piece.end === "sentence" ? SENTENCE_DROP_COST : PHRASE_DROP_COST)),
  );
  const lengthCost = (seconds: number, expected: number) => {
    const tolerance = LENGTH_TOLERANCE * expected + TOLERANCE_LETTERS / lettersPerSecond;
    return ((seconds - expected) / tolerance) ** 2;
  };
  return {
    // The boundaries between `from` and `to` are left out.
    clip: (from, to, seconds) =>
      lengthCost(seconds, expectedBefore[to + 1] - expectedBefore[from + 1]) +
      dropBefore[to] -
      dropBefore[from + 1],
    cut: (boundary, pause) => {
      const weight = pieces[boundary].end === "sentence" ? SENTENCE_PAUSE_BONUS : PHRASE_PAUSE_BONUS;
      const { start, end } = list[pause];
      return -weight * Math.log((end - start) / minSeconds);
    },
  };
}

/** `totals[i]` is the sum of the first `i` values. */
function runningTotals(values: number[]): number[] {
  const totals = [0];
  for (const value of values) totals.push(totals[totals.length - 1] + value);
  return totals;
}

/** A boundary cut at one of the pauses, both by index. */
interface Cut {
  boundary: number;
  pause: number;
}

/** Before any cut: boundary -1, at the first sound. */
const START: Cut = { boundary: -1, pause: -1 };

/**
 * The cheapest cuts, in order: for every boundary and pause, the cheapest
 * way to have cut there, built from the cheapest ways to have made an
 * earlier cut.
 */
function cheapestCuts(boundaryCount: number, pauses: SpokenPauses, costs: CutCosts): (Pause | null)[] {
  const { list, speechBefore } = pauses;
  // best[b][p]: the cost of everything up to cutting boundary b at pause p; came[b][p]: the cut before.
  const best = Array.from({ length: boundaryCount }, () => new Float64Array(list.length).fill(Infinity));
  const came = Array.from({ length: boundaryCount }, () => new Array<Cut>(list.length));
  for (let b = 0; b < boundaryCount; b++) {
    for (let p = 0; p < list.length; p++) {
      let cost = b < MAX_JOINED_PIECES ? costs.clip(-1, b, speechBefore[p]) : Infinity;
      let previous = START;
      for (let a = Math.max(0, b - MAX_JOINED_PIECES); a < b; a++) {
        for (let q = 0; q < p; q++) {
          const total = best[a][q] + costs.clip(a, b, speechBefore[p] - speechBefore[q]);
          if (total < cost) {
            cost = total;
            previous = { boundary: a, pause: q };
          }
        }
      }
      best[b][p] = cost + costs.cut(b, p);
      came[b][p] = previous;
    }
  }
  return traceCuts(best, came, pauses, costs);
}

/** Follows the cheapest whole passage back from its last clip, which runs to the end. */
function traceCuts(best: Float64Array[], came: Cut[][], pauses: SpokenPauses, costs: CutCosts): (Pause | null)[] {
  const { list, speechBefore, totalSpeech } = pauses;
  const boundaryCount = best.length;
  // With no cut at all, the passage is one clip.
  let cost = costs.clip(-1, boundaryCount, totalSpeech);
  let last = START;
  best.forEach((row, b) =>
    row.forEach((upTo, p) => {
      const total = upTo + costs.clip(b, boundaryCount, totalSpeech - speechBefore[p]);
      if (total < cost) {
        cost = total;
        last = { boundary: b, pause: p };
      }
    }),
  );
  const cuts: (Pause | null)[] = new Array(boundaryCount).fill(null);
  for (let cut = last; cut !== START; cut = came[cut.boundary][cut.pause]) cuts[cut.boundary] = list[cut.pause];
  return cuts;
}

/** Pieces of text between the chosen cuts, each with its stretch of audio. */
function joinAtCuts(pieces: Piece[], cuts: (Pause | null)[], within: Clip): Segment[] {
  const segments: Segment[] = [];
  let first = pieces[0];
  let start = within.start;
  pieces.forEach((piece, index) => {
    const cut = cuts[index];
    if (index < cuts.length && cut === null) return;
    const end = cut ? Math.min(cut.start + CUT_PADDING_SECONDS, cut.end) : within.end;
    segments.push({ from: first.from, to: piece.to, clip: { start, end } });
    if (cut) {
      start = Math.max(cut.end - CUT_PADDING_SECONDS, cut.start);
      first = pieces[index + 1];
    }
  });
  return segments;
}
