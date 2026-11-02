// Where a passage's sentences and phrases begin and end, from its text alone.

export interface TextRange {
  from: number;
  to: number;
}

/**
 * Where a piece of text ends: a sentence, a phrase, or a phrase too short to
 * play on its own, which joins the next one. A clip can end only at the
 * first two, but a voice may pause at any of them.
 */
export type PieceEnd = "sentence" | "phrase" | "joined";

export interface Piece extends TextRange {
  end: PieceEnd;
}

/** A phrase shorter than this many words joins its neighbor; lists like "A, B, and C" stay whole. */
const MIN_PHRASE_WORDS = 4;

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

/** The passage cut at every sentence end, comma, semicolon and dash. */
export function splitPieces(text: string): Piece[] {
  return splitSentences(text).flatMap((sentence) => {
    const phraseEnds = new Set(splitPhrases(text, sentence).map((phrase) => phrase.to));
    const pieces = splitAtMatches(text, sentence, PHRASE_END);
    return pieces.map((piece, index): Piece => {
      if (index === pieces.length - 1) return { ...piece, end: "sentence" };
      return { ...piece, end: phraseEnds.has(piece.to) ? "phrase" : "joined" };
    });
  });
}

/** Roughly how long the text takes to say, in letters. */
export function spokenLength(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
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
