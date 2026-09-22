import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DisputesRepository,
  type DisputeListFilters,
  type DisputeRow,
  type ExpectationRow,
  type MovementRow,
  type ReconciliationLinkRow,
} from '../../dal/disputes/disputes.repository';
import { SettingsService } from '../settings/settings.service';
import { isUuid } from '../../types/guards';
import { addDays } from '../tasks/recurrence-engine';
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
import {
  AUTO_LINK_KEY,
  AUTO_LINK_MARGIN_KEY,
  AUTO_LINK_MIN_SCORE_KEY,
  DISPUTES_ENABLED_KEY,
  REVIEW_THRESHOLD_KEY,
  SUGGESTION_AGE_KEY,
  TOLERANCE_AFTER_KEY,
  TOLERANCE_BEFORE_KEY,
  autoLinkConfig,
  disputesEnabled,
  matcherConfig,
  suggestionAgeDays,
} from './dispute-settings';

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

/** Effective values of the engine settings, as the panel shows them. */
export interface EngineSettings {
  enabled: boolean;
  toleranceBefore: number;
  toleranceAfter: number;
  reviewThresholdPercent: number;
  autoLink: boolean;
  autoLinkMinScore: number;
  autoLinkMargin: number;
  suggestionAgeDays: number;
}

/** A dispute as the API returns it. */
export interface DisputeView {
  id: string;
  type: DisputeRow['type'];
  status: DisputeRow['status'];
  taskId: string | null;
  expectationId: string | null;
  movementId: string | null;
  resolution: DisputeRow['resolution'];
  resolutionNote: string | null;
  evidence: Record<string, unknown> | null;
  detectedAt: Date;
  resolvedAt: Date | null;
}

/**
 * Dispute engine (spec 019). It compares the materialized expectations of payment tasks with
 * what finances recorded, links what is undoubted, opens a dispute for what is not, and
 * consults instead of guessing when a window holds more than one candidate.
 *
 * Finance stays the single source of truth of amounts: the engine writes links, dispute
 * states and the status of an expectation, never a movement or a price.
 */
@Injectable()
export class DisputesService {
  private readonly log = new Logger(DisputesService.name);

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

  // ============ READS ============

  async list(filters: DisputeListFilters): Promise<DisputeView[]> {
    const rows = await this.repo.list(filters);
    return rows.map((row) => this.toView(row));
  }

  async get(id: string): Promise<DisputeView> {
    const dispute = await this.repo.findById(this.requireUuid(id, 'dispute id'));
    if (!dispute) throw new NotFoundException('dispute not found');
    return this.toView(dispute);
  }

  /** The consultation of one expectation: the candidates a human answers about. */
  async candidatesOf(expectationId: string): Promise<Array<{ movementId: string; reason: string; createdAt: Date }>> {
    const id = this.requireUuid(expectationId, 'expectation id');
    const expectation = await this.repo.findExpectation(id);
    if (!expectation) throw new NotFoundException('expectation not found');
    return this.repo.listCandidates(id);
  }

  // ============ RESOLUTIONS ============

  /**
   * Manual resolution of a dispute. What the resolution means depends on the type: a missing
   * payment is either dropped or left pending, a late one is linked to the movement that paid
   * it, and an unplanned charge is either linked to an expectation or dismissed.
   */
  async resolve(
    id: string,
    body: { resolution?: unknown; note?: unknown; movementId?: unknown; expectationId?: unknown; taskStatus?: unknown },
  ): Promise<DisputeView> {
    const dispute = await this.repo.findById(this.requireUuid(id, 'dispute id'));
    if (!dispute) throw new NotFoundException('dispute not found');
    if (dispute.status === 'resolved') throw new BadRequestException('dispute is already resolved');

    const resolution = String(body.resolution ?? '');
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    const allowed = RESOLUTIONS_BY_TYPE[dispute.type];
    if (!allowed.includes(resolution)) {
      throw new BadRequestException(`resolution must be one of: ${allowed.join(', ')}`);
    }

    if (resolution === 'paid_late') {
      if (!dispute.expectationId) throw new BadRequestException('this dispute has no expectation to settle');
      await this.link(dispute.expectationId, this.requireUuid(String(body.movementId ?? ''), 'movement id'));
      await this.repo.resolve(dispute.id, 'paid_late', note, 'settled');
      return this.get(dispute.id);
    }

    if (resolution === 'linked_manual') {
      if (!dispute.movementId) throw new BadRequestException('this dispute has no movement to link');
      await this.link(this.requireUuid(String(body.expectationId ?? ''), 'expectation id'), dispute.movementId);
      await this.repo.resolve(dispute.id, 'linked_manual', note, 'settled');
      return this.get(dispute.id);
    }

    if (resolution === 'cancelled' && dispute.taskId) {
      await this.repo.cancelFutureExpectations(dispute.taskId, today());
      const taskStatus = this.taskStatus(body.taskStatus);
      if (taskStatus) await this.repo.updateTaskStatus(dispute.taskId, taskStatus);
    }

    const expectationStatus =
      resolution === 'cancelled' ? 'cancelled' : resolution === 'not_registered' ? 'pending' : null;
    const updated = await this.repo.resolve(dispute.id, resolution as DisputeResolution, note, expectationStatus);
    if (!updated) throw new NotFoundException('dispute not found');
    return this.toView(updated);
  }

  /** Answer to a consultation: pick the movement (or the candidate), or say none belongs here. */
  async decideSuggestion(
    expectationId: string,
    movementId: string | null,
    candidateId?: string | null,
  ): Promise<{ expectationId: string; status: ExpectationRow['status'] }> {
    const id = this.requireUuid(expectationId, 'expectation id');
    const expectation = await this.repo.findExpectation(id);
    if (!expectation) throw new NotFoundException('expectation not found');
    if (expectation.status !== 'suggestion') throw new BadRequestException('expectation is not waiting for an answer');
    const config = matcherConfig(this.settings);

    // The panel answers with the candidate it showed; the id of the movement works too.
    let chosen = movementId;
    if (!chosen && candidateId) {
      const candidates = await this.repo.listCandidates(id);
      const candidate = candidates.find((row) => row.id === this.requireUuid(candidateId, 'candidate id'));
      if (!candidate) throw new NotFoundException('candidate not found');
      chosen = candidate.movementId;
    }

    if (chosen) {
      await this.link(id, this.requireUuid(chosen, 'movement id'));
      await this.repo.deleteCandidatesForExpectation(id);
      return { expectationId: id, status: 'settled' };
    }

    await this.repo.deleteCandidatesForExpectation(id);
    await this.repo.updateExpectationStatus(id, 'pending');
    const window = windowOf(expectation.expectedOn, config);
    if (today() > window.to) {
      await this.openMissing(expectation, config);
      return { expectationId: id, status: 'exception' };
    }
    return { expectationId: id, status: 'pending' };
  }


  /** Manual link: a human answer always wins and is never rewritten by the engine. */
  async link(expectationId: string, movementId: string): Promise<void> {
    const expectation = await this.repo.findExpectation(expectationId);
    if (!expectation) throw new NotFoundException('expectation not found');
    const movement = await this.repo.findMovement(movementId);
    if (!movement) throw new NotFoundException('movement not found');
    if (await this.repo.findLinkByExpectation(expectationId)) {
      throw new BadRequestException('expectation is already settled');
    }
    if (await this.repo.findLinkByMovement(movementId)) {
      throw new BadRequestException('movement is already linked to another expectation');
    }
    await this.repo.createLink(expectationId, movementId, 'manual', null, null);
    // A human answer is the strongest signal available: it weighs double in the history.
    await this.repo.recordMatch(
      expectation.taskId,
      deviationDays(expectation.expectedOn, movement.date.toISOString().slice(0, 10)),
      Number(movement.amount),
      2,
    );
  }

  /** What the engine learned about one task id: the panel shows it beside the task. */
  async matchHistory(taskId: string): Promise<MatchHistory & { taskId: string; lastMatchedAt: Date | null }> {
    const id = this.requireUuid(taskId, 'task id');
    const task = await this.repo.findTask(id);
    if (!task) throw new NotFoundException('task not found');
    const row = await this.repo.findMatchHistory(id);
    if (!row) return { taskId: id, ...EMPTY_HISTORY, lastMatchedAt: null };
    return {
      taskId: id,
      averageDelayDays: Number(row.averageDelayDays),
      sampleCount: row.sampleCount,
      lastAmounts: row.lastAmounts ?? [],
      lastMatchedAt: row.lastMatchedAt,
    };
  }

  /** Effective settings of the engine: what the settings screen shows and edits. */
  engineSettings(): EngineSettings {
    const matcher = matcherConfig(this.settings);
    const auto = autoLinkConfig(this.settings);
    return {
      enabled: disputesEnabled(this.settings),
      toleranceBefore: matcher.toleranceBefore,
      toleranceAfter: matcher.toleranceAfter,
      reviewThresholdPercent: matcher.reviewThresholdPercent,
      autoLink: auto.enabled,
      autoLinkMinScore: auto.minScore,
      autoLinkMargin: auto.margin,
      suggestionAgeDays: suggestionAgeDays(this.settings),
    };
  }

  /**
   * Patches the engine settings. Only the keys present change, and every value is validated
   * here so a bad one never reaches a run: a tolerance of -1 would silently break the windows.
   */
  async updateEngineSettings(patch: Record<string, unknown>): Promise<EngineSettings> {
    const writes: Array<[string, unknown]> = [];
    if (patch.enabled !== undefined) writes.push([DISPUTES_ENABLED_KEY, this.boolean(patch.enabled, 'enabled')]);
    if (patch.autoLink !== undefined) writes.push([AUTO_LINK_KEY, this.boolean(patch.autoLink, 'autoLink')]);
    if (patch.toleranceBefore !== undefined) {
      writes.push([TOLERANCE_BEFORE_KEY, this.counter(patch.toleranceBefore, 'toleranceBefore')]);
    }
    if (patch.toleranceAfter !== undefined) {
      writes.push([TOLERANCE_AFTER_KEY, this.counter(patch.toleranceAfter, 'toleranceAfter')]);
    }
    if (patch.reviewThresholdPercent !== undefined) {
      writes.push([REVIEW_THRESHOLD_KEY, this.counter(patch.reviewThresholdPercent, 'reviewThresholdPercent', 100)]);
    }
    if (patch.autoLinkMinScore !== undefined) {
      writes.push([AUTO_LINK_MIN_SCORE_KEY, this.counter(patch.autoLinkMinScore, 'autoLinkMinScore', 100)]);
    }
    if (patch.autoLinkMargin !== undefined) {
      writes.push([AUTO_LINK_MARGIN_KEY, this.counter(patch.autoLinkMargin, 'autoLinkMargin', 100)]);
    }
    if (patch.suggestionAgeDays !== undefined) {
      writes.push([SUGGESTION_AGE_KEY, this.counter(patch.suggestionAgeDays, 'suggestionAgeDays', 365)]);
    }
    for (const [key, value] of writes) await this.settings.set(key, value);
    return this.engineSettings();
  }

  private boolean(value: unknown, label: string): boolean {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException(`${label} must be a boolean`);
  }

  private counter(value: unknown, label: string, max = 365): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      throw new BadRequestException(`${label} must be an integer between 0 and ${max}`);
    }
    return parsed;
  }

  /** The link of one expectation, with the movement it points at: what the panel shows. */
  async linkOf(expectationId: string): Promise<{
    link: ReconciliationLinkRow;
    movement: MovementRow;
  } | null> {
    const id = this.requireUuid(expectationId, 'expectation id');
    const link = await this.repo.findLinkByExpectation(id);
    if (!link) return null;
    const movement = await this.repo.findMovement(link.movementId);
    if (!movement) return null;
    return { link, movement };
  }

  /** Unlinking frees the movement again and returns the expectation to waiting. */
  async unlink(expectationId: string): Promise<{ expectationId: string; movementId: string | null }> {
    const id = this.requireUuid(expectationId, 'expectation id');
    const movementId = await this.repo.deleteLinkByExpectation(id);
    if (!movementId) throw new NotFoundException('expectation has no link');
    return { expectationId: id, movementId };
  }

  // ============ MAINTENANCE ============

  /**
   * Undoes everything automatic and recomputes: the fix for a tolerance or a declared
   * category that was wrong. Manual links, manual resolutions and resolved disputes stay.
   */
  async rebuild(): Promise<{ links: number; disputes: number; reset: number; run: RunResult }> {
    const links = await this.repo.deleteAutomaticLinks();
    const disputes = await this.repo.deleteOpenDisputes();
    const reset = await this.repo.resetSuggestions();
    const run = await this.run();
    this.log.log(`Rebuild: ${links} automatic links, ${disputes} open disputes, ${reset} consultations reset`);
    return { links, disputes, reset, run };
  }

  // ============ DECLARED CATEGORIES ============

  async categoryLinks(taskId: string): Promise<string[]> {
    const id = this.requireUuid(taskId, 'task id');
    const task = await this.repo.findTask(id);
    if (!task) throw new NotFoundException('task not found');
    return (await this.repo.listCategoryLinks(id)).map((row) => row.categoryId);
  }

  /** Replaces the declaration of a task; unknown category ids are rejected, not ignored. */
  async setCategoryLinks(taskId: string, categoryIds: unknown): Promise<string[]> {
    const id = this.requireUuid(taskId, 'task id');
    const task = await this.repo.findTask(id);
    if (!task) throw new NotFoundException('task not found');
    if (!Array.isArray(categoryIds)) throw new BadRequestException('categoryIds must be an array');
    const ids = [...new Set(categoryIds.map((value) => this.requireUuid(String(value), 'category id')))];
    const found = await this.repo.findCategoryIds(ids);
    if (found.length !== ids.length) throw new NotFoundException('one of the categories does not exist');
    await this.repo.replaceCategoryLinks(id, ids);
    return ids;
  }

  // ============ HELPERS ============

  private toView(row: DisputeRow): DisputeView {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      taskId: row.taskId,
      expectationId: row.expectationId,
      movementId: row.movementId,
      resolution: row.resolution,
      resolutionNote: row.resolutionNote,
      evidence: row.evidence ?? null,
      detectedAt: row.detectedAt,
      resolvedAt: row.resolvedAt,
    };
  }

  private requireUuid(value: string, label: string): string {
    if (!isUuid(value)) throw new BadRequestException(`invalid ${label}`);
    return value;
  }

  private taskStatus(value: unknown): 'active' | 'paused' | 'deleted' | null {
    if (value === undefined || value === null) return null;
    if (value !== 'active' && value !== 'paused' && value !== 'deleted') {
      throw new BadRequestException('taskStatus must be active, paused or deleted');
    }
    return value;
  }
}

/** Which resolutions a type accepts: the shape of the question the panel asks. */
const RESOLUTIONS_BY_TYPE: Record<DisputeRow['type'], string[]> = {
  missing: ['cancelled', 'not_registered', 'dismissed'],
  late: ['paid_late', 'dismissed'],
  unplanned: ['linked_manual', 'dismissed'],
};

type DisputeResolution = NonNullable<DisputeRow['resolution']>;

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
