import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { DisputesService, type DisputeView, type RunResult } from '../../bll/disputes/disputes.service';
import type { DisputeListFilters } from '../../dal/disputes/disputes.repository';
import { isUuid } from '../../types/guards';

/**
 * Disputes gateway (spec 019). The fixed routes are declared before the `:id` ones so they
 * never fall into the id parameter, and every id is validated before it reaches SQL.
 */
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

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

  /** Discards the consulta of an expectation: a candidate, or none of them. */
  @Post('suggestions/:expectationId/decide')
  decide(
    @Param('expectationId') expectationId: string,
    @Body() body: { movementId?: string | null },
  ): Promise<{ expectationId: string; status: string }> {
    const movementId = body?.movementId ? this.uuid(body.movementId) : null;
    return this.disputes.decideSuggestion(this.uuid(expectationId), movementId);
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
