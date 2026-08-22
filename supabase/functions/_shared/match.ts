/**
 * Cross-provider match scoring.
 *
 * The problem: Spotify says `4uLU6hMCjMI75M1A2tKUQC` is "Never Gonna Give You
 * Up" by Rick Astley, 3:33. YouTube offers a hundred videos for that phrase —
 * the official upload, a live version, three remixes, a nightcore edit, and a
 * guy reacting to it. Picking wrong is worse than not matching at all, because
 * a wrong pick gets cached forever and every listener on the other provider
 * hears a different song than the rest of the room.
 *
 * Everything here is pure and dependency-free so the Edge Function and a plain
 * unit-test runner can both import it.
 */

/**
 * Below this we refuse to auto-link and ask the user instead. Tuned so a
 * correct match with a slightly-off title (a "Remastered" reissue, a translated
 * title) still clears it, while a same-artist-different-song lands under it.
 */
export const ACCEPT_THRESHOLD = 0.75;

export type MatchTarget = {
  title: string;
  artist: string;
  durationMs: number;
};

export type MatchCandidate = MatchTarget & {
  /** YouTube channel title. Undefined for Spotify candidates. */
  channel?: string | null;
};

/**
 * Duration is weighted heaviest on purpose. Titles and artist strings are
 * written by uploaders and lie constantly; a recording's length is a property
 * of the audio itself. Two files of the same song agree on it to within a
 * second or two, and no amount of creative titling changes that.
 */
const WEIGHT = { duration: 0.45, title: 0.3, artist: 0.15 } as const;

/** Auto-generated "Artist - Topic" uploads are the label's own audio: right cut, no intro. */
const TOPIC_BONUS = 0.1;

/** A live/remix/cover nobody asked for is a hard fail, not a near miss. */
const VARIANT_PENALTY = 0.35;

/** Same recording, allowing for fade trims and metadata rounding. */
const DURATION_EXACT_S = 2;
/** Beyond this it is a different edit at best. */
const DURATION_HOPELESS_S = 15;

// --------------------------------------------------------------- normalisation

/**
 * Bracketed noise uploaders bolt onto titles. Matching on the words rather than
 * stripping every bracket keeps the meaningful ones — "(Acoustic)", "(Radio
 * Edit)" is noise but "(Slowed)" must survive to be penalised.
 */
const NOISE_WORDS = [
  'official',
  'officiel',
  'lyrics?',
  'lyric\\s*video',
  'audio',
  'visuali[sz]er',
  'video',
  'hd',
  'hq',
  '4k',
  '8k',
  'mv',
  're-?master(?:ed)?',
  'explicit',
  'clean\\s*version',
  'radio\\s*edit',
  'full\\s*(?:song|version)',
  'audio\\s*only',
  'color\\s*coded',
  'free\\s*download',
].join('|');

const NOISE_BRACKET = new RegExp(
  `[(\\[{][^)\\]}]*\\b(?:${NOISE_WORDS})\\b[^)\\]}]*[)\\]}]`,
  'gi'
);

/** The unbracketed form: `Song - Official Music Video`. */
const NOISE_TAIL = new RegExp(
  `\\s*[-–—|]\\s*(?:(?:the\\s+)?(?:new\\s+)?(?:official\\s+)?(?:music\\s+)?(?:${NOISE_WORDS})\\b[^-–—|]*)$`,
  'i'
);

const FEAT_BRACKET = /[([{]\s*(?:feat|ft|featuring|w\/|with)\b\.?[^)\]}]*[)\]}]/gi;
const FEAT_TAIL = /\s+(?:feat|ft|featuring)\b\.?\s+.*$/i;

/** NFKD + combining-mark strip, so "Beyoncé" and "Beyonce" are the same artist. */
function foldAccents(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '');
}

function squash(value: string): string {
  return value.replace(/\s{2,}/g, ' ').trim();
}

/** Lowercased and accent-folded, but punctuation intact so `\b` still anchors. */
function plainLower(value: string): string {
  return squash(foldAccents(String(value ?? '')).toLowerCase());
}

/**
 * Case-preserving noise removal — what we store in `tracks.title`, so the UI
 * shows "Blinding Lights" and not "The Weeknd - Blinding Lights (Official Video)".
 */
export function cleanTitle(raw: string): string {
  return squash(String(raw ?? '').replace(NOISE_BRACKET, ' ').replace(NOISE_TAIL, ''));
}

/**
 * The comparison form: lowercase, accent-folded, noise and featured-artist
 * clauses removed, punctuation flattened to spaces. Featured artists go because
 * one provider puts them in the title and the other in the artist field.
 */
export function normalizeTitle(s: string): string {
  return squash(
    foldAccents(cleanTitle(s))
      .toLowerCase()
      .replace(FEAT_BRACKET, ' ')
      .replace(FEAT_TAIL, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
  );
}

function tokenSet(value: string): Set<string> {
  const out = new Set<string>();
  for (const token of normalizeTitle(value).split(' ')) {
    if (token) out.add(token);
  }
  return out;
}

// ------------------------------------------------------------------ similarity

/**
 * Order-insensitive token overlap in 0..1 (Jaccard). Word order carries no
 * signal worth keeping across providers — "Song (Radio Edit)" one side,
 * "Radio Edit - Song" the other.
 */
export function tokenSetRatio(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

/** How much of `needle` appears in `haystack`, 0..1. Asymmetric on purpose. */
function containment(needle: string, haystack: string): number {
  const left = tokenSet(needle);
  const right = tokenSet(haystack);
  if (left.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / left.size;
}

/**
 * Wrong-recording markers. Each is tested against candidate AND target: a remix
 * target legitimately matches a remix candidate, so only an unasked-for variant
 * is penalised.
 */
const VARIANT_MARKERS: readonly RegExp[] = [
  /\blive\b/,
  /\bcovers?\b/,
  /\bcovered\s+by\b/,
  /\bre-?mix(?:es|ed)?\b/,
  /\breaction\b/,
  /\breacts?\s+to\b/,
  /\b8\s?d\b/,
  /\bsped\s*up\b/,
  /\bspeed\s*up\b/,
  /\bslowed\b/,
  /\bnightcore\b/,
  /\bkaraoke\b/,
  /\binstrumental\b/,
];

function hasUnaskedVariant(candidateTitle: string, targetTitle: string): boolean {
  const candidate = plainLower(candidateTitle);
  const target = plainLower(targetTitle);
  return VARIANT_MARKERS.some((marker) => marker.test(candidate) && !marker.test(target));
}

const TOPIC_SUFFIX = /\s*-\s*topic\s*$/i;

function isTopicChannel(channel: string | null | undefined): boolean {
  return !!channel && TOPIC_SUFFIX.test(channel);
}

/** "Rick Astley - Topic" is just "Rick Astley" for artist comparison. */
function stripTopicSuffix(channel: string | null | undefined): string {
  return channel ? channel.replace(TOPIC_SUFFIX, '').trim() : '';
}

/**
 * 1.0 inside 2s, linear decay to 0 at 15s. Linear rather than a cliff so a
 * 6-second gap reads as "probably a different master" instead of a flat reject,
 * and the other signals still get to vote.
 */
function durationScore(targetMs: number, candidateMs: number): number {
  // A missing duration is unverified, not neutral: scoring it 0 forces the
  // match to clear the threshold on title and artist alone, which it rarely
  // can. Better to ask the user than to guess without the strongest signal.
  if (!Number.isFinite(targetMs) || !Number.isFinite(candidateMs)) return 0;
  if (targetMs <= 0 || candidateMs <= 0) return 0;

  const diffSeconds = Math.abs(targetMs - candidateMs) / 1000;
  if (diffSeconds <= DURATION_EXACT_S) return 1;
  if (diffSeconds >= DURATION_HOPELESS_S) return 0;
  return 1 - (diffSeconds - DURATION_EXACT_S) / (DURATION_HOPELESS_S - DURATION_EXACT_S);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Confidence in 0..1 that `candidate` is the same recording as `target`. */
export function scoreCandidate(target: MatchTarget, candidate: MatchCandidate): number {
  const duration = durationScore(target.durationMs, candidate.durationMs);

  // YouTube titles almost always carry the artist too ("Rick Astley - Never
  // Gonna Give You Up"), which drags plain Jaccard down on a perfect match.
  // Full containment of the target title is worth nearly as much, but capped
  // under 1.0 so a genuine exact token match still outranks a title that merely
  // swallowed ours among ten other words.
  const title = Math.max(
    tokenSetRatio(target.title, candidate.title),
    0.85 * containment(target.title, candidate.title)
  );

  const channel = stripTopicSuffix(candidate.channel);
  const candidateArtist = [candidate.artist, channel].filter(Boolean).join(' ');
  // The artist may live in the channel name, the artist field, or inside the
  // title. Take the most generous reading — a false negative here costs a match
  // that duration already vouched for.
  const artist = Math.max(
    tokenSetRatio(target.artist, candidateArtist),
    containment(target.artist, `${candidateArtist} ${candidate.title}`)
  );

  let score = duration * WEIGHT.duration + title * WEIGHT.title + artist * WEIGHT.artist;
  if (isTopicChannel(candidate.channel)) score += TOPIC_BONUS;
  if (hasUnaskedVariant(candidate.title, target.title)) score -= VARIANT_PENALTY;

  return clamp01(score);
}

export type ScoredCandidate<C extends MatchCandidate> = { candidate: C; score: number };

/** Every candidate scored, best first. Generic so callers keep their own fields. */
export function rankCandidates<C extends MatchCandidate>(
  target: MatchTarget,
  candidates: readonly C[]
): ScoredCandidate<C>[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(target, candidate) }))
    .sort((a, b) => b.score - a.score);
}
