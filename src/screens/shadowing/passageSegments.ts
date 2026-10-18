// Cuts a passage into sentences or phrases that can be played on their own.
// The text says where sentences and phrases end; the audio says where the
// voice actually pauses. A boundary is used only where both agree, so a clip
// never starts or stops in the middle of a word.

/** A stretch of a passage's audio, in seconds. */
export interface Clip {
  start: number;
  end: number;
}

/** A silence in a passage's audio, in seconds. */
export type Pause = Clip;

/** What was measured in a passage's audio. */
export interface PassageTiming {
  duration: number;
  /** Every silence, in order, including any at the very start or end. */
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

/** A phrase shorter than this many words joins its neighbor; lists like "A, B, and C" stay whole. */
const MIN_PHRASE_WORDS = 4;

/**
 * A pause lasts at least as long as saying this many letters; shorter
 * silences are the closures inside words like "act". Measured in letters
 * rather than seconds so that it holds for fast and slow voices alike.
 */
const MIN_PAUSE_LETTERS = 2.5;

/** How far, as a share of the speech, a pause may be from where its boundary is expected. */
const POSITION_TOLERANCE = 0.1;
/** How much a longer pause is preferred over a shorter one at the same distance. */
const LONG_PAUSE_BONUS = 0.5;
/** Leaving a boundary out costs as much as a pause two tolerances away. */
const DROP_COST = 4;

/** Frames quieter than this, relative to the voice's usual loudness, are silence. */
const SILENCE_DB = -45;
const FRAME_SECONDS = 0.01;

/** Silence kept at each side of a cut, so that soft first and last sounds are not lost. */
const CUT_PADDING_SECONDS = 0.12;

/**
 * Splits the passage into sentences or phrases and finds each one in the
 * audio. Where the voice does not pause at a boundary, the pieces on either
 * side stay together. A passage without any usable pause is one segment.
 */
export function segmentPassage(text: string, timing: PassageTiming, unit: SegmentUnit): Segment[] {
  const pauses = spokenPauses(text, timing);
  const sentences = splitSentences(text);
  const sentenceCuts = findCuts(text, sentences, pauses, pauses.speech);
  const sentenceSegments = joinAtCuts(sentences, sentenceCuts, { start: 0, end: timing.duration });
  if (unit === "sentence") return sentenceSegments;

  return sentenceSegments.flatMap((sentence) => {
    const phrases = splitPhrases(text, sentence);
    const cuts = findCuts(text, phrases, pauses, unpadded(sentence.clip, pauses.speech));
    return joinAtCuts(phrases, cuts, sentence.clip);
  });
}

// -- Text --------------------------------------------------------------------

interface TextRange {
  from: number;
  to: number;
}

const SENTENCE_END = /[.!?…]+["'’”»)\]]*(?=\s|$)|[。！？]+[」』’”）)]*/gu;
const PHRASE_END = /[,;:]["'’”»)\]]*(?=\s)|\s[—–-](?=\s)|—|[，、；：]/gu;
/** A period after these does not end the sentence: "Mr. Smith", "J. K. Rowling", "e.g. this". */
const ABBREVIATION = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|e\.g|i\.e|\p{Lu})\.$/u;

export function splitSentences(text: string): TextRange[] {
  const ranges = splitAtMatches(text, { from: 0, to: text.length }, SENTENCE_END);
  // Rejoin a range that ends in an abbreviation, or is followed by a lowercase word.
  return ranges.reduce<TextRange[]>((sentences, range) => {
    const previous = sentences[sentences.length - 1];
    const continuesPrevious =
      previous !== undefined &&
      (ABBREVIATION.test(text.slice(previous.from, previous.to)) ||
        /^\p{Ll}/u.test(text.slice(range.from)));
    if (continuesPrevious) previous.to = range.to;
    else sentences.push({ ...range });
    return sentences;
  }, []);
}

function splitPhrases(text: string, sentence: TextRange): TextRange[] {
  const phrases: TextRange[] = [];
  let carriedFrom: number | null = null;
  for (const range of splitAtMatches(text, sentence, PHRASE_END)) {
    const phrase: TextRange = { from: carriedFrom ?? range.from, to: range.to };
    const isShort = wordCount(text.slice(phrase.from, phrase.to)) < MIN_PHRASE_WORDS;
    const previous = phrases[phrases.length - 1];
    if (!isShort) {
      phrases.push(phrase);
      carriedFrom = null;
    } else if (previous) {
      previous.to = phrase.to;
    } else {
      carriedFrom = phrase.from;
    }
  }
  if (carriedFrom !== null) phrases.push({ from: carriedFrom, to: sentence.to });
  return phrases;
}

/** The text in `range` cut after every match of `pattern`, without surrounding whitespace. */
function splitAtMatches(text: string, range: TextRange, pattern: RegExp): TextRange[] {
  const ranges: TextRange[] = [];
  let from = range.from;
  for (const match of text.slice(range.from, range.to).matchAll(pattern)) {
    const to = range.from + match.index + match[0].length;
    pushTrimmed(text, ranges, from, to);
    from = to;
  }
  pushTrimmed(text, ranges, from, range.to);
  return ranges;
}

function pushTrimmed(text: string, ranges: TextRange[], from: number, to: number) {
  while (from < to && /\s/u.test(text[from])) from++;
  while (to > from && /\s/u.test(text[to - 1])) to--;
  if (/[\p{L}\p{N}]/u.test(text.slice(from, to))) ranges.push({ from, to });
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/** Each Chinese or Japanese character counts as a word, since those are written without spaces. */
function wordCount(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return cjk + (words?.length ?? 0);
}

/** Roughly how long the text takes to say, in letters. */
function spokenLength(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

// -- Audio -------------------------------------------------------------------

/**
 * Finds the silences in mono audio samples. Loudness is measured against
 * the voice's usual level rather than the loudest moment, so one loud
 * syllable does not turn quiet speech into silence.
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
  const threshold = voiceLevel * 10 ** (SILENCE_DB / 20);

  const frameSeconds = frameLength / sampleRate;
  const pauses: Pause[] = [];
  let silentFrom: number | null = null;
  for (let frame = 0; frame <= frameCount; frame++) {
    const isSilent = frame < frameCount && levels[frame] < threshold;
    if (isSilent && silentFrom === null) silentFrom = frame;
    if (!isSilent && silentFrom !== null) {
      pauses.push({ start: silentFrom * frameSeconds, end: frame * frameSeconds });
      silentFrom = null;
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

/** The silences of a passage that are long enough to be pauses. */
interface SpokenPauses {
  list: Pause[];
  /** The shortest silence that counts, judged by how fast the passage is spoken. */
  minSeconds: number;
  /** From the first sound to the last. */
  speech: Clip;
}

function spokenPauses(text: string, { duration, pauses }: PassageTiming): SpokenPauses {
  const leading = pauses.find((pause) => pause.start <= 0);
  const trailing = pauses.find((pause) => pause.end >= duration - FRAME_SECONDS);
  const speech = { start: leading?.end ?? 0, end: trailing?.start ?? duration };

  const silence = pauses.reduce((sum, pause) => sum + pause.end - pause.start, 0);
  const lettersPerSecond = spokenLength(text) / (duration - silence);
  const minSeconds =
    Number.isFinite(lettersPerSecond) && lettersPerSecond > 0
      ? MIN_PAUSE_LETTERS / lettersPerSecond
      : Infinity;
  const list = pauses.filter((pause) => pause.end - pause.start >= minSeconds);
  return { list, minSeconds, speech };
}

/** A sentence's clip without the silence it was cut with. */
function unpadded(clip: Clip, speech: Clip): Clip {
  return {
    start: Math.max(clip.start + CUT_PADDING_SECONDS, speech.start),
    end: Math.min(clip.end - CUT_PADDING_SECONDS, speech.end),
  };
}

/**
 * For each boundary between consecutive pieces of text, the pause in `span`
 * where it is spoken, or null where none fits.
 *
 * Each boundary is expected where its share of the letters says, on a clock
 * that leaves out silence. Long pauses close to where they are expected fit
 * best; a boundary without a good enough pause is dropped.
 */
function findCuts(
  text: string,
  pieces: TextRange[],
  pauses: SpokenPauses,
  span: Clip,
): (Pause | null)[] {
  const candidates = pauses.list.filter((pause) => pause.start > span.start && pause.end < span.end);

  // Where each candidate is on the speech-only clock, and how long that clock runs.
  let silenceBefore = 0;
  const positions = candidates.map((pause) => {
    const position = pause.start - span.start - silenceBefore;
    silenceBefore += pause.end - pause.start;
    return position;
  });
  const speechSeconds = span.end - span.start - silenceBefore;

  const lengths = pieces.map((piece) => spokenLength(text.slice(piece.from, piece.to)));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0) || 1;
  let lengthBefore = 0;
  const expected = lengths.slice(0, -1).map((length) => {
    lengthBefore += length;
    return (lengthBefore / totalLength) * speechSeconds;
  });

  const matchCost = (boundary: number, candidate: number) => {
    const miss = (positions[candidate] - expected[boundary]) / (POSITION_TOLERANCE * speechSeconds);
    const { start, end } = candidates[candidate];
    return miss * miss - LONG_PAUSE_BONUS * Math.log((end - start) / pauses.minSeconds);
  };
  return matchInOrder(expected.length, candidates.length, matchCost).map((candidate) =>
    candidate === null ? null : candidates[candidate],
  );
}

/**
 * The cheapest way to give each boundary its own candidate, keeping both in
 * order, or none at `DROP_COST`. Returns a candidate index (or null) per boundary.
 */
function matchInOrder(
  boundaryCount: number,
  candidateCount: number,
  matchCost: (boundary: number, candidate: number) => number,
): (number | null)[] {
  // best[b][c]: the lowest cost of placing the first b boundaries using only the first c candidates.
  const best = Array.from({ length: boundaryCount + 1 }, () =>
    new Array<number>(candidateCount + 1).fill(0),
  );
  for (let b = 1; b <= boundaryCount; b++) {
    best[b][0] = best[b - 1][0] + DROP_COST;
    for (let c = 1; c <= candidateCount; c++) {
      best[b][c] = Math.min(
        best[b][c - 1],
        best[b - 1][c] + DROP_COST,
        best[b - 1][c - 1] + matchCost(b - 1, c - 1),
      );
    }
  }

  // Walk back through the choices that led to the best total.
  const matches: (number | null)[] = new Array(boundaryCount).fill(null);
  for (let b = boundaryCount, c = candidateCount; b > 0; ) {
    if (c > 0 && best[b][c] === best[b][c - 1]) {
      c--;
    } else if (best[b][c] === best[b - 1][c] + DROP_COST) {
      b--;
    } else {
      matches[b - 1] = c - 1;
      b--;
      c--;
    }
  }
  return matches;
}

/** Pieces of text between the chosen cuts, each with its stretch of audio. */
function joinAtCuts(pieces: TextRange[], cuts: (Pause | null)[], within: Clip): Segment[] {
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
