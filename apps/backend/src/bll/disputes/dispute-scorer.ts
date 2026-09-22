/**
 * Probabilistic scoring of the dispute engine (spec 020). It receives data and returns numbers:
 * pure, no DI, no database, so every weight and rule is testable without a server.
 *
 * The engine does not replace the consultation with a guess: it replaces "here are two
 * candidates with no explanation" with "here are the candidates, this is how confident I am,
 * and this is the metadata that supports it".
 */

/** Weights in one place, so tuning is a single file and not a hunt. */
export const SCORING_WEIGHTS = {
  /** Normalized name of the task against the description of the movement. */
  name: 35,
  /** User or mail wherever the task states it, against the movement text. */
  metadata: 25,
  /** Distance between the charge and the estimate (or the last amounts of the history). */
  amount: 20,
  /** Distance between the charge date and the date the history says this task pays. */
  date: 20,
} as const;

export interface ScorerTaskMetadata {
  title: string;
  description: string | null;
  notes: string | null;
  sectorName: string | null;
}

export interface ScorerMovement {
  id: string;
  description: string;
  note: string | null;
  amount: number;
  /** `YYYY-MM-DD`. */
  date: string;
}

/** What the engine learned about one task id. An empty history is the cold start. */
export interface MatchHistory {
  averageDelayDays: number;
  sampleCount: number;
  lastAmounts: number[];
}

export const EMPTY_HISTORY: MatchHistory = { averageDelayDays: 0, sampleCount: 0, lastAmounts: [] };

export interface ScoredCandidate {
  movementId: string;
  /** 0-100. */
  score: number;
  /** Which signal contributed and how much: the panel shows it next to the percentage. */
  signals: Record<string, number>;
  /** 1 is the best of its consultation; set by `rankCandidates`. */
  rank?: number;
}

export interface AutoLinkConfig {
  enabled: boolean;
  minScore: number;
  margin: number;
}

export const DEFAULT_AUTO_LINK: AutoLinkConfig = { enabled: false, minScore: 85, margin: 25 };

/** Lowercase, accents and punctuation folded: `NETFLIX.COM` and `netflix` are the same token. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokens worth comparing: short ones are noise ("de", "sa", "com"). */
export function tokens(text: string): string[] {
  return [...new Set(normalize(text).split(' ').filter((token) => token.length >= 3))];
}

/** How much of the task name appears in the text of the movement: 0 to 1. */
export function nameAffinity(title: string, text: string): number {
  const name = tokens(title);
  if (name.length === 0) return 0;
  const haystack = normalize(text);
  const hits = name.filter((token) => haystack.includes(token)).length;
  return hits / name.length;
}

/**
 * How much of the extra metadata (user, mail, notes, sector) appears in the movement text.
 * Measured part by part: the user is usually one token inside a mail, and `mixtan` inside
 * `mixtan218@gmail.com` matching the note of the task is a full hit for that part.
 */
export function metadataAffinity(parts: Array<string | null>, text: string): number {
  const meaningful = parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => tokens(part))
    .filter((tokensOfPart) => tokensOfPart.length > 0);
  if (meaningful.length === 0) return 0;
  const haystack = normalize(text);
  const hits = meaningful.filter((tokensOfPart) => tokensOfPart.some((token) => haystack.includes(token))).length;
  return hits / meaningful.length;
}

/** 1 when the amount is within tolerance, degrading with the distance; 0.5 when unknowable. */
export function amountFit(amount: number, expectationAmount: number | null, history: MatchHistory): number {
  const reference =
    expectationAmount !== null && expectationAmount > 0
      ? expectationAmount
      : history.lastAmounts.length > 0
        ? history.lastAmounts.reduce((total, value) => total + value, 0) / history.lastAmounts.length
        : null;
  if (reference === null || reference === 0) return 0.5;
  const deviation = Math.abs((amount - reference) / reference) * 100;
  if (deviation <= 15) return 1;
  return Math.max(0, 1 - (deviation - 15) / 85);
}


/** 1 when the charge lands on the day the history predicts, degrading with the distance. */
export function dateFit(date: string, expectedOn: string, history: MatchHistory): number {
  // A cold start has nothing to compare: a neutral value keeps the signal from deciding.
  if (history.sampleCount < 2) return 0.5;
  const predicted = shiftDays(expectedOn, history.averageDelayDays);
  const distance = Math.abs(dayDistance(date, predicted));
  if (distance === 0) return 1;
  return Math.max(0, 1 - distance / 7);
}

export function dayDistance(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function shiftDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.round(days));
  return date.toISOString().slice(0, 10);
}

/**
 * Score of one candidate: the weighted sum of the four signals, 0-100. The amount never
 * disqualifies and the date never disqualifies: they move the score, and the human decides.
 */
export function scoreCandidate(
  movement: ScorerMovement,
  task: ScorerTaskMetadata,
  expectationAmount: number | null,
  expectedOn: string,
  history: MatchHistory,
): ScoredCandidate {
  const text = `${movement.description} ${movement.note ?? ''}`;
  const name = nameAffinity(task.title, text);
  const metadata = metadataAffinity([task.description, task.notes, task.sectorName], text);
  const amount = amountFit(movement.amount, expectationAmount, history);
  const date = dateFit(movement.date, expectedOn, history);

  const signals = {
    name: round(SCORING_WEIGHTS.name * name),
    metadata: round(SCORING_WEIGHTS.metadata * metadata),
    amount: round(SCORING_WEIGHTS.amount * amount),
    date: round(SCORING_WEIGHTS.date * date),
  };
  return {
    movementId: movement.id,
    score: round(Object.values(signals).reduce((total, value) => total + value, 0)),
    signals,
  };
}

/** Candidates best first, with their rank: 1 is the one the panel shows on top. */
export function rankCandidates(
  movements: ScorerMovement[],
  task: ScorerTaskMetadata,
  expectationAmount: number | null,
  expectedOn: string,
  history: MatchHistory,
): ScoredCandidate[] {
  return movements
    .map((movement) => scoreCandidate(movement, task, expectationAmount, expectedOn, history))
    .sort((a, b) => b.score - a.score || a.movementId.localeCompare(b.movementId))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export type ScoredDecision =
  /** The best candidate is confident enough and beats the second by a real margin. */
  | { kind: 'auto-link'; candidate: ScoredCandidate }
  /** Otherwise the human answers, with the percentages in front of them. */
  | { kind: 'consult'; candidates: ScoredCandidate[] };

/**
 * The gate: a high score on two near candidates is a dispute waiting to happen, which is
 * exactly the case the user described as "if the difference is minimal, ask". With the switch
 * off (the default) everything is a consultation.
 */
export function decideWithScores(
  candidates: ScoredCandidate[],
  autoLink: AutoLinkConfig = DEFAULT_AUTO_LINK,
): ScoredDecision {
  if (candidates.length === 0) return { kind: 'consult', candidates: [] };
  const [best, second] = candidates;
  if (!autoLink.enabled) return { kind: 'consult', candidates };
  if (best.score < autoLink.minScore) return { kind: 'consult', candidates };
  if (second && best.score - second.score < autoLink.margin) return { kind: 'consult', candidates };
  return { kind: 'auto-link', candidate: best };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
