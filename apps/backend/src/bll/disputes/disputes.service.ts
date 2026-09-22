import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DisputesRepository,
  type DisputeListFilters,
  type DisputeRow,
  type ReconciliationLinkRow,
  type MovementRow,
} from '../../dal/disputes/disputes.repository';
import { DisputePassService, type RunResult } from './dispute-pass.service';
import { EMPTY_HISTORY, type MatchHistory } from './dispute-scorer';
import { requireUuid } from './dispute-params';

/** The pass result keeps its home in the pass service; re-exported for the gateway. */
export type { RunResult };

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
 * Reads, maintenance and declarations of the dispute engine (spec 022). The pass lives in
 * `DisputePassService`, the manual answers in `DisputeResolutionsService` and the settings
 * surface in `DisputeEngineSettingsService`; what is left here is what the panel and the
 * maintenance endpoints need, plus a thin `run` that delegates so the scheduler and the gateway
 * keep their shape.
 */
@Injectable()
export class DisputesService {
  private readonly log = new Logger(DisputesService.name);

  constructor(
    private readonly repo: DisputesRepository,
    private readonly pass: DisputePassService,
  ) {}

  /** One pass of the engine: the whole comparison, delegated to the service that owns it. */
  async run(): Promise<RunResult> {
    return this.pass.run();
  }

  // ============ READS ============

  async list(filters: DisputeListFilters): Promise<DisputeView[]> {
    const rows = await this.repo.list(filters);
    return rows.map((row) => this.viewOf(row));
  }

  async get(id: string): Promise<DisputeView> {
    const dispute = await this.repo.findById(requireUuid(id, 'dispute id'));
    if (!dispute) throw new NotFoundException('dispute not found');
    return this.viewOf(dispute);
  }

  /** The consultation of one expectation: the candidates a human answers about. */
  async candidatesOf(expectationId: string): Promise<Array<{ movementId: string; reason: string; createdAt: Date }>> {
    const id = requireUuid(expectationId, 'expectation id');
    const expectation = await this.repo.findExpectation(id);
    if (!expectation) throw new NotFoundException('expectation not found');
    return this.repo.listCandidates(id);
  }

  // ============ READS ============
  async matchHistory(taskId: string): Promise<MatchHistory & { taskId: string; lastMatchedAt: Date | null }> {
    const id = requireUuid(taskId, 'task id');
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

  /** The link of one expectation, with the movement it points at: what the panel shows. */
  async linkOf(expectationId: string): Promise<{
    link: ReconciliationLinkRow;
    movement: MovementRow;
  } | null> {
    const id = requireUuid(expectationId, 'expectation id');
    const link = await this.repo.findLinkByExpectation(id);
    if (!link) return null;
    const movement = await this.repo.findMovement(link.movementId);
    if (!movement) return null;
    return { link, movement };
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
    const id = requireUuid(taskId, 'task id');
    const task = await this.repo.findTask(id);
    if (!task) throw new NotFoundException('task not found');
    return (await this.repo.listCategoryLinks(id)).map((row) => row.categoryId);
  }

  /** Replaces the declaration of a task; unknown category ids are rejected, not ignored. */
  async setCategoryLinks(taskId: string, categoryIds: unknown): Promise<string[]> {
    const id = requireUuid(taskId, 'task id');
    const task = await this.repo.findTask(id);
    if (!task) throw new NotFoundException('task not found');
    if (!Array.isArray(categoryIds)) throw new BadRequestException('categoryIds must be an array');
    const ids = [...new Set(categoryIds.map((value) => requireUuid(String(value), 'category id')))];
    const found = await this.repo.findCategoryIds(ids);
    if (found.length !== ids.length) throw new NotFoundException('one of the categories does not exist');
    await this.repo.replaceCategoryLinks(id, ids);
    return ids;
  }

  // ============ HELPERS ============

  /** Row to API shape. Public because the resolutions service answers with the same view. */
  viewOf(row: DisputeRow): DisputeView {
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

}
