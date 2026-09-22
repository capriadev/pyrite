import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  DisputesService,
  type DisputeView,
  type EngineSettings,
  type RunResult,
} from '../../bll/disputes/disputes.service';
import { DisputesIntakeService, type MovementIntake } from '../../bll/disputes/disputes-intake.service';
import type { DisputeListFilters } from '../../dal/disputes/disputes.repository';
import { isUuid } from '../../types/guards';

/**
 * Disputes gateway (spec 019). The fixed routes are declared before the `:id` ones so they
 * never fall into the id parameter, and every id is validated before it reaches SQL.
 */
@Controller('disputes')
export class DisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly intake: DisputesIntakeService,
  ) {}

  @Get()
  list(@Query('type') type?: string, @Query('status') status?: string): Promise<DisputeView[]> {
    const filters: DisputeListFilters = {};
    if (type) filters.type = type as DisputeListFilters['type'];
    if (status) filters.status = status as DisputeListFilters['status'];
    return this.disputes.list(filters);
  }

  /** The candidates of a consultation, in the order the panel shows them. */
  @Get('candidates/:expectationId')
  candidates(@Param('expectationId') expectationId: string) {
    return this.disputes.candidatesOf(this.uuid(expectationId));
  }

  /** Effective engine settings: what the settings screen shows. */
  @Get('settings')
  engineSettings(): EngineSettings {
    return this.disputes.engineSettings();
  }

  /** Only the keys present change; every value is validated before it is stored. */
  @Put('settings')
  updateEngineSettings(@Body() body: Record<string, unknown>): Promise<EngineSettings> {
    return this.disputes.updateEngineSettings(body ?? {});
  }

  /** The link of one expectation: null when it is not settled. */
  @Get('links/:expectationId')
  linkOf(@Param('expectationId') expectationId: string) {
    return this.disputes.linkOf(this.uuid(expectationId));
  }

  /** Manual run. Answers 409 when the engine is parked by settings. */
  @Post('run')
  run(): Promise<RunResult> {
    return this.disputes.run();
  }

  // ============ INTAKE (spec 021) ============

  /** The question about one movement, asked again on demand (the answer is never cached). */
  @Get('intake/:movementId')
  intakeOf(@Param('movementId') movementId: string): Promise<MovementIntake> {
    return this.intake.intakeFor(this.uuid(movementId));
  }

  /** The user's answer: create the task with the draft, or link to the one that existed. */
  @Post('intake/confirm')
  confirmIntake(@Body() body: Record<string, unknown>): Promise<MovementIntake> {
    return this.intake.confirm(body ?? {});
  }

  /** "No, it is nothing of the sort": remembered, so it is asked once. */
  @Post('intake/dismiss')
  dismissIntake(@Body() body: { movementId?: string }): Promise<{ movementId: string; dismissed: true }> {
    return this.intake.dismiss(String(body?.movementId ?? ''));
  }

  /** Answer to a consultation: a candidate (or a movement), or none of them. */
  @Post('suggestions/:expectationId/decide')
  decide(
    @Param('expectationId') expectationId: string,
    @Body() body: { movementId?: string | null; candidateId?: string | null },
  ): Promise<{ expectationId: string; status: string }> {
    const movementId = body?.movementId ? this.uuid(body.movementId) : null;
    const candidateId = body?.candidateId ? this.uuid(body.candidateId) : null;
    return this.disputes.decideSuggestion(this.uuid(expectationId), movementId, candidateId);
  }

  // ============ LINKS ============

  @Post('links')
  @HttpCode(201)
  link(@Body() body: { expectationId?: string; movementId?: string }): Promise<{ ok: true }> {
    if (!body?.expectationId || !body?.movementId) {
      throw new BadRequestException('expectationId and movementId are required');
    }
    return this.disputes
      .link(this.uuid(body.expectationId), this.uuid(body.movementId))
      .then(() => ({ ok: true as const }));
  }

  /** Unlinking frees the movement: a later run may use it again. */
  @Delete('links/:expectationId')
  unlink(@Param('expectationId') expectationId: string): Promise<{ expectationId: string; movementId: string | null }> {
    return this.disputes.unlink(this.uuid(expectationId));
  }

  /** Undoes everything automatic and recomputes, keeping the manual answers. */
  @Post('rebuild')
  rebuild() {
    return this.disputes.rebuild();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<DisputeView> {
    return this.disputes.get(this.uuid(id));
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body()
    body: { resolution: string; note?: string; movementId?: string; expectationId?: string; taskStatus?: string },
  ): Promise<DisputeView> {
    return this.disputes.resolve(this.uuid(id), body);
  }

  private uuid(value: string): string {
    if (!isUuid(value)) throw new BadRequestException('invalid id');
    return value;
  }
}
