import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DisputesRepository,
  type ExpectationRow,
  type MovementRow,
} from '../../dal/disputes/disputes.repository';
import { SettingsService } from '../settings/settings.service';
import { addDays } from '../../types/dates';
import { requireUuid } from './dispute-params';
import {
  autoLinkConfig,
  disputesEnabled,
  matcherConfig,
  suggestionAgeDays,
} from './dispute-settings';
import {
  decide,
  deviationDays,
  lateCandidate,
  today,
  unplanned,
  windowOf,
  type MatcherConfig,
  type MatcherExpectation,
  type MatcherMovement,
} from './dispute-matcher';
import {
  EMPTY_HISTORY,
  decideWithScores,
  dayDistance,
  rankCandidates,
  type MatchHistory,
  type ScoredCandidate,
} from './dispute-scorer';

/** What one pass of the engine did, logged and returned by the manual run. */
export interface RunResult {
  expectations: number;
  settled: number;
  consultations: number;
  missing: number;
  late: number;
  unplanned: number;
  /** Consultations that aged out unanswered and became missing (spec 020). */
  aged: number;
  skipped: number;
}

/**
 * The pass of the dispute engine (spec 022): one walk over every payment expectation whose date
 * already passed, deciding for each one whether it settles, waits, asks or opens a dispute.
 *
 * It is idempotent by construction: a settled expectation is skipped, a consumed movement
 * cannot be reused and an open dispute of the same shape is not duplicated, so a second pass
 * changes nothing.
 *
 * Finance stays the single source of truth of amounts: this service writes links, dispute
 * states, expectations and the learned history, never a movement or a price.
 */
@Injectable()
export class DisputePassService {
  private readonly log = new Logger(DisputePassService.name);

  constructor(
    private readonly repo: DisputesRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Manual and scheduled runs share this gate: a parked engine runs nothing. */
  private requireEnabled(): void {
    if (!disputesEnabled(this.settings)) throw new ConflictException('disputes engine is disabled');
  }

  // ============ THE PASS ============

  /**
   * One pass over every payment expectation whose date already passed. Idempotent by
   * construction: a settled expectation is skipped, a consumed movement cannot be reused and
   * an open dispute of the same shape is not duplicated, so a second pass changes nothing.
   */
  async run(): Promise<RunResult> {
    this.requireEnabled();
    const config = matcherConfig(this.settings);
    const day = today();
    const result: RunResult = {
      expectations: 0,
      settled: 0,
      consultations: 0,
      missing: 0,
      late: 0,
      unplanned: 0,
      aged: 0,
      skipped: 0,
    };

    const declarations = await this.repo.listAllCategoryLinks();
    const categoriesByTask = new Map<string, string[]>();
    for (const row of declarations) {
      categoriesByTask.set(row.taskId, [...(categoriesByTask.get(row.taskId) ?? []), row.categoryId]);
    }
    if (categoriesByTask.size === 0) {
      this.log.log('Run: no declared categories, nothing to reconcile');
      return result;
    }

    result.aged = await this.ageConsultations(day, suggestionAgeDays(this.settings), config);

    const expectations = await this.repo.listPendingPaymentExpectations(day);
    result.expectations = expectations.length;
    const consumed = new Set(await this.repo.listLinkedMovementIds());
    const declaredCategoryIds = [...new Set(declarations.map((row) => row.categoryId))];
    const movementRows = await this.movementsFor(expectations, categoriesByTask, declaredCategoryIds, config);
    const movements = movementRows.map((row) => movementOf(row));
    const historyByTask = await this.historyFor(expectations);
    const autoLink = autoLinkConfig(this.settings);
    const claimed = new Set<string>();
    const waiting = await this.repo.listExpectationsByTaskIds([...categoriesByTask.keys()]);

    for (const expectation of expectations) {
      const categoryIds = categoriesByTask.get(expectation.taskId);
      if (!categoryIds || categoryIds.length === 0) {
        // No declaration: the engine does not guess, the expectation can be linked by hand.
        result.skipped += 1;
        continue;
      }
      const own = movements.filter((movement) => categoryIds.includes(movement.categoryId));
      const decision = decide(matcherOf(expectation), own, consumed, day, config);

      if (decision.kind === 'settle') {
        const existing = await this.repo.findLinkByExpectation(expectation.id);
        if (existing) {
          result.skipped += 1;
          continue;
        }
        await this.repo.createLink(
          expectation.id,
          decision.movementId,
          'declared',
          decision.amountDeviation === null ? null : String(decision.amountDeviation),
          decision.reviewNote,
        );
        // The engine learns from its own link: one more sample of how this task pays.
        await this.learn(expectation, movementRows, decision.movementId, 'declared');
        consumed.add(decision.movementId);
        result.settled += 1;
        continue;
      }

      if (decision.kind === 'suggest') {
        const ranked = this.rank(expectation, decision.movementIds, movementRows, historyByTask.get(expectation.taskId));
        const scored = decideWithScores(ranked, autoLink);
        if (scored.kind === 'auto-link') {
          await this.repo.createLink(expectation.id, scored.candidate.movementId, 'declared', null, null);
          await this.learn(expectation, movementRows, scored.candidate.movementId, 'declared');
          consumed.add(scored.candidate.movementId);
          result.settled += 1;
          continue;
        }
        await this.repo.replaceCandidates(
          expectation.id,
          scored.candidates.map((candidate) => ({
            movementId: candidate.movementId,
            reason: `score ${candidate.score}`,
            score: Math.round(candidate.score),
            rank: candidate.rank ?? null,
            signals: candidate.signals,
          })),
        );
        await this.repo.updateExpectationStatus(expectation.id, 'suggestion');
        result.consultations += 1;
        continue;
      }

      if (decision.kind === 'missing') {
        // Before calling it missing: the payment may simply have arrived later than the
        // tolerance. That question ("did you pay this late?") is the one the user answers.
        const late = lateCandidate(
          matcherOf(expectation),
          own,
          consumed,
          this.nextWindowStart(waiting, expectation.taskId, expectation.expectedOn, config, day),
          day,
          config,
        );
        if (late) {
          await this.openLate(expectation, late, config);
          claimed.add(late.id);
          result.late += 1;
          continue;
        }
        await this.openMissing(expectation, config);
        result.missing += 1;
        continue;
      }

      result.skipped += 1;
    }

    result.unplanned = await this.openUnplanned(declarations, consumed, claimed, config, day);
    this.log.log(
      `Run: ${result.expectations} expectations, ${result.settled} settled, ` +
        `${result.consultations} consultations, ${result.missing} missing, ${result.late} late, ` +
        `${result.unplanned} unplanned, ${result.aged} aged out`,
    );
    return result;
  }

  /** Where the next charge of the same task starts expecting: the ceiling of a late payment. */
  private nextWindowStart(
    waiting: ExpectationRow[],
    taskId: string,
    expectedOn: string,
    config: MatcherConfig,
    day: string,
  ): string {
    const following = waiting
      .filter((row) => row.taskId === taskId && row.expectedOn > expectedOn)
      .map((row) => row.expectedOn)
      .sort()[0];
    return following ? windowOf(following, config).from : addDays(day, 1);
  }

  /** The window closed and a movement arrived after it: the question is "paid late?". */
  private async openLate(expectation: ExpectationRow, movement: MatcherMovement, config: MatcherConfig): Promise<void> {
    const existing = await this.repo.findOpenByExpectation(expectation.id);
    if (existing) return;
    await this.repo.openDispute(
      {
        type: 'late',
        taskId: expectation.taskId,
        expectationId: expectation.id,
        movementId: movement.id,
        status: 'open',
        evidence: {
          expectedOn: expectation.expectedOn,
          window: windowOf(expectation.expectedOn, config),
          movementOn: movement.date,
          deviationDays: deviationDays(expectation.expectedOn, movement.date),
        },
      },
      'exception',
    );
  }

  /** One query for every movement the pass may need: the widest window around the expectations. */
  private async movementsFor(
    expectations: Array<ExpectationRow & { taskTitle: string }>,
    categoriesByTask: Map<string, string[]>,
    declaredCategoryIds: string[],
    config: MatcherConfig,
  ): Promise<MovementRow[]> {
    const windows = expectations
      .filter((expectation) => categoriesByTask.has(expectation.taskId))
      .map((expectation) => windowOf(expectation.expectedOn, config));
    if (windows.length === 0) return [];
    const from = windows.map((window) => window.from).sort()[0];
    const to = windows.map((window) => window.to).sort().at(-1) as string;
    return this.repo.listMovementsInWindow(declaredCategoryIds, from, to);
  }

  /** The learned history of the tasks of this pass, keyed by task id. */
  private async historyFor(expectations: Array<ExpectationRow & { taskTitle: string }>): Promise<Map<string, MatchHistory>> {
    const taskIds = [...new Set(expectations.map((expectation) => expectation.taskId))];
    const rows = await this.repo.listMatchHistory(taskIds);
    return new Map(
      rows.map((row) => [
        row.taskId,
        {
          averageDelayDays: Number(row.averageDelayDays),
          sampleCount: row.sampleCount,
          lastAmounts: row.lastAmounts ?? [],
        },
      ]),
    );
  }

  /** Scores and ranks the candidates of one consultation with everything known about the task. */
  private rank(
    expectation: ExpectationRow & { taskTitle: string; taskDescription: string | null; taskNotes: string | null; taskSectorName: string | null },
    movementIds: string[],
    movementRows: MovementRow[],
    history: MatchHistory | undefined,
  ): ScoredCandidate[] {
    const movements = movementRows
      .filter((row) => movementIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        description: row.description,
        note: row.note,
        amount: Number(row.amount),
        date: row.date.toISOString().slice(0, 10),
      }));
    return rankCandidates(
      movements,
      {
        title: expectation.taskTitle,
        description: expectation.taskDescription,
        notes: expectation.taskNotes,
        sectorName: expectation.taskSectorName,
      },
      expectation.estimatedAmount === null ? null : Number(expectation.estimatedAmount),
      expectation.expectedOn,
      history ?? EMPTY_HISTORY,
    );
  }

  /** Records one confirmed link in the history of the task: what makes the next pass smarter. */
  private async learn(
    expectation: ExpectationRow,
    movementRows: MovementRow[],
    movementId: string,
    matchedBy: 'declared' | 'manual',
  ): Promise<void> {
    const movement = movementRows.find((row) => row.id === movementId);
    if (!movement) return;
    const date = movement.date.toISOString().slice(0, 10);
    await this.repo.recordMatch(
      expectation.taskId,
      deviationDays(expectation.expectedOn, date),
      Number(movement.amount),
      matchedBy === 'manual' ? 2 : 1,
    );
  }

  /**
   * A consultation nobody answered ages out: it is not a suggestion forever. Falling to a
   * missing dispute is the honest reading - nobody confirmed it and no link exists.
   */
  private async ageConsultations(day: string, ageDays: number, config: MatcherConfig): Promise<number> {
    const suggestions = await this.repo.listConstrainedExpectations('suggestion');
    let aged = 0;
    for (const expectation of suggestions) {
      const oldest = await this.repo.oldestCandidateAt(expectation.id);
      if (!oldest) continue;
      if (dayDistance(day, oldest.toISOString().slice(0, 10)) < ageDays) continue;
      await this.repo.deleteCandidatesForExpectation(expectation.id);
      await this.repo.updateExpectationStatus(expectation.id, 'pending');
      await this.openMissing(expectation, config);
      aged += 1;
    }
    if (aged > 0) this.log.log(`Run: ${aged} consultation(s) aged out to missing`);
    return aged;
  }

  /**
   * Reports one expectation as missing. Public because the resolutions service needs it when a
   * consultation expires unanswered (spec 022): the evidence shape lives here, once.
   */
  async reportMissingDispute(expectationId: string): Promise<void> {
    const expectation = await this.repo.findExpectation(requireUuid(expectationId, 'expectation id'));
    if (!expectation) throw new NotFoundException('expectation not found');
    await this.openMissing(expectation, matcherConfig(this.settings));
  }

  /** A window that closed with nothing in it: the payment never showed up. */
  private async openMissing(expectation: ExpectationRow, config: MatcherConfig): Promise<void> {
    const existing = await this.repo.findOpenByExpectation(expectation.id);
    if (existing) return;
    await this.repo.openDispute(
      {
        type: 'missing',
        taskId: expectation.taskId,
        expectationId: expectation.id,
        status: 'open',
        evidence: {
          expectedOn: expectation.expectedOn,
          window: windowOf(expectation.expectedOn, config),
          estimatedAmount: expectation.estimatedAmount,
        },
      },
      'exception',
    );
  }

  /** Movements in a declared category that no expectation was waiting for. */
  private async openUnplanned(
    declarations: Array<{ taskId: string; categoryId: string }>,
    consumed: Set<string>,
    claimed: Set<string>,
    config: MatcherConfig,
    day: string,
  ): Promise<number> {
    const taskIds = [...new Set(declarations.map((row) => row.taskId))];
    const all = await this.repo.listExpectationsByTaskIds(taskIds);
    // Only what is still waiting covers a movement: once an expectation is settled, another
    // charge in the same window is a double charge and belongs in this list.
    const waiting = all.filter(
      (row) =>
        row.status === 'pending' &&
        // Only what has already happened can cover a movement of the past.
        row.expectedOn <= day,
    );
    const windows: Array<{ expectation: MatcherExpectation; categoryIds: string[] }> = waiting.map((expectation) => ({
      expectation: matcherOf(expectation),
      categoryIds: declarations.filter((row) => row.taskId === expectation.taskId).map((row) => row.categoryId),
    }));

    const declaredCategoryIds = [...new Set(declarations.map((row) => row.categoryId))];
    const declaredMovements = (await this.repo.listMovementsOfCategories(declaredCategoryIds)).map((row) =>
      movementOf(row),
    );
    const ids = unplanned(declaredMovements, windows, consumed, claimed, config);

    let opened = 0;
    for (const movementId of ids) {
      const movement = declaredMovements.find((row) => row.id === movementId);
      if (!movement) continue;
      const existing = await this.repo.findOpenByMovement(movementId);
      if (existing) continue;
      const declaredBy = declarations
        .filter((row) => row.categoryId === movement.categoryId)
        .map((row) => row.taskId);
      await this.repo.openDispute(
        {
          type: 'unplanned',
          taskId: declaredBy[0] ?? null,
          movementId,
          status: 'open',
          evidence: { movementOn: movement.date, categoryId: movement.categoryId, declaredBy },
        },
        null,
      );
      opened += 1;
    }
    return opened;
  }
}

/** The matcher speaks plain numbers; the rows carry numeric columns as strings. */
function matcherOf(expectation: ExpectationRow): MatcherExpectation {
  return {
    id: expectation.id,
    taskId: expectation.taskId,
    expectedOn: expectation.expectedOn,
    estimatedAmount: expectation.estimatedAmount === null ? null : Number(expectation.estimatedAmount),
  };
}

function movementOf(row: MovementRow): MatcherMovement {
  return {
    id: row.id,
    categoryId: row.categoryId,
    amount: Number(row.amount),
    date: row.date.toISOString().slice(0, 10),
  };
}
