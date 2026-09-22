import { addDays, isoDay } from '../tasks/recurrence-engine';

/**
 * Deterministic heart of the dispute engine (spec 019). It receives data and returns a
 * decision; it touches no database, so every rule is testable without a server.
 *
 * The posture is to consult, not to guess: a single candidate settles because the declared
 * category and the window leave no room for doubt, and two candidates never resolve
 * themselves. Amounts never decide a match - a deviation is measured and written as a review
 * note, which is the whole reason a fixed price in USD can settle against a charge that the
 * platform converted.
 */

export interface MatcherConfig {
  /** Days before the expected date still accepted. */
  toleranceBefore: number;
  /** Days after the expected date still accepted. */
  toleranceAfter: number;
  /** Amount deviation (percent) above which the link carries a review note. */
  reviewThresholdPercent: number;
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  toleranceBefore: 3,
  toleranceAfter: 7,
  reviewThresholdPercent: 15,
};

/** What the matcher needs of an expectation. */
export interface MatcherExpectation {
  id: string;
  taskId: string;
  expectedOn: string;
  /** Fixed estimate, when the price is not rotating. */
  estimatedAmount: number | null;
}

/** What the matcher needs of a movement. */
export interface MatcherMovement {
  id: string;
  categoryId: string;
  amount: number;
  /** Movement date as `YYYY-MM-DD`. */
  date: string;
}

export type MatcherDecision =
  /** One candidate and no doubt: link it. */
  | { kind: 'settle'; movementId: string; deviationDays: number; amountDeviation: number | null; reviewNote: string | null }
  /** Two or more candidates: the expectation waits for a human answer. */
  | { kind: 'suggest'; movementIds: string[] }
  /** The window closed with nothing in it. */
  | { kind: 'missing' }
  /** Still inside the window: nothing to do yet, not even a dispute. */
  | { kind: 'wait' };

export interface Window {
  from: string;
  to: string;
}

/** `[expected - toleranceBefore, expected + toleranceAfter]`, both sides inclusive. */
export function windowOf(expectedOn: string, config: MatcherConfig): Window {
  return {
    from: addDays(expectedOn, -config.toleranceBefore),
    to: addDays(expectedOn, config.toleranceAfter),
  };
}

export function isInside(date: string, window: Window): boolean {
  return date >= window.from && date <= window.to;
}

/** Whole days from the expected date to the real one: positive is late, negative is early. */
export function deviationDays(expectedOn: string, movementOn: string): number {
  return Math.round((Date.parse(`${movementOn}T00:00:00Z`) - Date.parse(`${expectedOn}T00:00:00Z`)) / 86_400_000);
}

/**
 * Percent deviation of the charge against the estimate, signed. Null when there is no fixed
 * estimate: a rotating price has nothing to compare, and that is by design.
 */
export function amountDeviation(estimated: number | null, real: number): number | null {
  if (estimated === null || estimated === 0) return null;
  return ((real - estimated) / estimated) * 100;
}

/**
 * Decisions of one expectation. `consumed` are the movement ids already linked to some other
 * expectation: a movement is used once, which is what stops a payment made ahead of time from
 * being eaten twice.
 */
export function decide(
  expectation: MatcherExpectation,
  movements: MatcherMovement[],
  consumed: ReadonlySet<string>,
  today: string,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): MatcherDecision {
  const window = windowOf(expectation.expectedOn, config);
  const candidates = movements.filter((movement) => !consumed.has(movement.id) && isInside(movement.date, window));

  if (candidates.length === 0) {
    return today > window.to ? { kind: 'missing' } : { kind: 'wait' };
  }

  if (candidates.length > 1) {
    return { kind: 'suggest', movementIds: candidates.map((movement) => movement.id) };
  }

  const movement = candidates[0];
  const deviation = amountDeviation(expectation.estimatedAmount, movement.amount);
  const days = deviationDays(expectation.expectedOn, movement.date);
  return {
    kind: 'settle',
    movementId: movement.id,
    deviationDays: days,
    amountDeviation: deviation === null ? null : Number(deviation.toFixed(2)),
    reviewNote: reviewNoteOf(deviation, config),
  };
}

/** A big deviation is information for the human eye, never a reason to reject the match. */
function reviewNoteOf(deviation: number | null, config: MatcherConfig): string | null {
  if (deviation === null) return null;
  if (Math.abs(deviation) <= config.reviewThresholdPercent) return null;
  return `amount differs from the estimate by ${deviation.toFixed(2)}%`;
}

/**
 * Movements nobody expects: in a declared category, not consumed, and outside the window of
 * every expectation that is still waiting for its money. A movement covered by a window whose
 * expectation is already settled is a double charge, and it belongs here too.
 */
export function unplanned(
  movements: MatcherMovement[],
  waitingExpectations: Array<{ expectation: MatcherExpectation; categoryIds: string[] }>,
  consumed: ReadonlySet<string>,
  claimed: ReadonlySet<string>,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): string[] {
  return movements
    .filter((movement) => !consumed.has(movement.id) && !claimed.has(movement.id))
    .filter((movement) =>
      !waitingExpectations.some(
        (entry) =>
          entry.categoryIds.includes(movement.categoryId) &&
          isInside(movement.date, windowOf(entry.expectation.expectedOn, config)),
      ),
    )
    .map((movement) => movement.id);
}

/**
 * The late payment of a closed window: a movement that arrived after the tolerance and before
 * the next charge of the same task, still unconsumed. It is the user's real case (paying the
 * 20th on the 2nd), and it deserves the question "did you pay this late?" instead of the
 * "did you drop the service?" that a missing window asks.
 */
export function lateCandidate(
  expectation: MatcherExpectation,
  movements: MatcherMovement[],
  consumed: ReadonlySet<string>,
  nextChargeWindowStart: string,
  today: string,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): MatcherMovement | null {
  const window = windowOf(expectation.expectedOn, config);
  const late = movements
    .filter((movement) => !consumed.has(movement.id))
    .filter((movement) => movement.date > window.to && movement.date < nextChargeWindowStart)
    .filter((movement) => movement.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return late[0] ?? null;
}

/** Today as a plain day, the only clock the matcher reads. */
export function today(): string {
  return isoDay(new Date());
}
