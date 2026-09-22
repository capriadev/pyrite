import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DisputesRepository, type DisputeRow, type ExpectationRow } from '../../dal/disputes/disputes.repository';
import { SettingsService } from '../settings/settings.service';
import { deviationDays, today, windowOf } from './dispute-matcher';
import { matcherConfig } from './dispute-settings';
import { optionalTaskStatus, requireUuid } from './dispute-params';
import { DisputesService, type DisputeView } from './disputes.service';
import { DisputePassService } from './dispute-pass.service';

/** Which resolutions a type accepts: the shape of the question the panel asks. */
const RESOLUTIONS_BY_TYPE: Record<DisputeRow['type'], string[]> = {
  missing: ['cancelled', 'not_registered', 'dismissed'],
  late: ['paid_late', 'dismissed'],
  unplanned: ['linked_manual', 'dismissed'],
};

type DisputeResolution = NonNullable<DisputeRow['resolution']>;

/**
 * Manual answers of the dispute engine (spec 022). Everything a human decides lives here:
 * resolving a dispute, answering a consultation, linking by hand and unlinking. The pass and
 * the reads stay in `DisputesService`, and the only thing this service borrows from it is
 * reporting an expectation as missing when a consultation expires - one public method instead
 * of a copy of the evidence shape.
 */
@Injectable()
export class DisputeResolutionsService {
  constructor(
    private readonly repo: DisputesRepository,
    private readonly settings: SettingsService,
    private readonly engine: DisputesService,
    private readonly pass: DisputePassService,
  ) {}

  /**
   * Manual resolution of a dispute. What the resolution means depends on the type: a missing
   * payment is either dropped or left pending, a late one is linked to the movement that paid
   * it, and an unplanned charge is either linked to an expectation or dismissed.
   */
  async resolve(
    id: string,
    body: { resolution?: unknown; note?: unknown; movementId?: unknown; expectationId?: unknown; taskStatus?: unknown },
  ): Promise<DisputeView> {
    const dispute = await this.repo.findById(requireUuid(id, 'dispute id'));
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
      await this.link(dispute.expectationId, requireUuid(String(body.movementId ?? ''), 'movement id'));
      await this.repo.resolve(dispute.id, 'paid_late', note, 'settled');
      return this.engine.get(dispute.id);
    }

    if (resolution === 'linked_manual') {
      if (!dispute.movementId) throw new BadRequestException('this dispute has no movement to link');
      await this.link(requireUuid(String(body.expectationId ?? ''), 'expectation id'), dispute.movementId);
      await this.repo.resolve(dispute.id, 'linked_manual', note, 'settled');
      return this.engine.get(dispute.id);
    }

    if (resolution === 'cancelled' && dispute.taskId) {
      await this.repo.cancelFutureExpectations(dispute.taskId, today());
      const taskStatus = optionalTaskStatus(body.taskStatus);
      if (taskStatus) await this.repo.updateTaskStatus(dispute.taskId, taskStatus);
    }

    const expectationStatus =
      resolution === 'cancelled' ? 'cancelled' : resolution === 'not_registered' ? 'pending' : null;
    const updated = await this.repo.resolve(dispute.id, resolution as DisputeResolution, note, expectationStatus);
    if (!updated) throw new NotFoundException('dispute not found');
    return this.engine.viewOf(updated);
  }

  /** Answer to a consultation: pick the movement (or the candidate), or say none belongs here. */
  async decideSuggestion(
    expectationId: string,
    movementId: string | null,
    candidateId?: string | null,
  ): Promise<{ expectationId: string; status: ExpectationRow['status'] }> {
    const id = requireUuid(expectationId, 'expectation id');
    const expectation = await this.repo.findExpectation(id);
    if (!expectation) throw new NotFoundException('expectation not found');
    if (expectation.status !== 'suggestion') throw new BadRequestException('expectation is not waiting for an answer');
    const config = matcherConfig(this.settings);

    // The panel answers with the candidate it showed; the id of the movement works too.
    let chosen = movementId;
    if (!chosen && candidateId) {
      const candidates = await this.repo.listCandidates(id);
      const candidate = candidates.find((row) => row.id === requireUuid(candidateId, 'candidate id'));
      if (!candidate) throw new NotFoundException('candidate not found');
      chosen = candidate.movementId;
    }

    if (chosen) {
      await this.link(id, requireUuid(chosen, 'movement id'));
      await this.repo.deleteCandidatesForExpectation(id);
      return { expectationId: id, status: 'settled' };
    }

    await this.repo.deleteCandidatesForExpectation(id);
    await this.repo.updateExpectationStatus(id, 'pending');
    const window = windowOf(expectation.expectedOn, config);
    if (today() > window.to) {
      await this.pass.reportMissingDispute(id);
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

  /** Unlinking frees the movement again and returns the expectation to waiting. */
  async unlink(expectationId: string): Promise<{ expectationId: string; movementId: string | null }> {
    const id = requireUuid(expectationId, 'expectation id');
    const movementId = await this.repo.deleteLinkByExpectation(id);
    if (!movementId) throw new NotFoundException('expectation has no link');
    return { expectationId: id, movementId };
  }
}
