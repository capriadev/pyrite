import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ApiKeysService } from '../apis/api-keys.service';
import { CountsService } from '../counts/counts.service';
import { NotesService } from '../notes/notes.service';
import { CryptoService, type CanaryData } from '../../services/crypto/crypto.service';
import { SectionKeysService } from '../../services/crypto/section-keys';
import { SettingsRepository } from '../../dal/settings/settings.repository';
import { RotationRepository, type RotationJobRow } from '../../dal/rotation/rotation.repository';
import { SectionWriteGuard } from './section-write-guard';
import type { SectionRotator } from './section-rotator';
import type { SectionName } from '../../services/crypto/crypto-config';

/** Shortest passphrase accepted as the new one: rotation is the only path that writes it. */
const MIN_PASSPHRASE_LENGTH = 8;

/** A job that moved to the background: the caller follows it through the status endpoint. */
export interface RotationStarted {
  jobId: string;
  status: 'staging';
  total: number;
}

/** A section with nothing to stage (vault, or no data yet): the swap happened inline. */
export interface RotationApplied {
  ok: true;
  section: SectionName;
  staged: number;
}

/** `done` with zeroes means there is no open job and no previous run to report. */
export interface RotationProgress {
  status: RotationJobRow['status'];
  total: number;
  processed: number;
  error?: string;
}

/**
 * Section passphrase rotation (spec 013). It owns the job and the state machine; the
 * domain knowledge lives in the rotators collected from every section service.
 *
 * The live canary is the commit marker: while it is unchanged the section answers to the
 * old passphrase, and the swap commits once, in one transaction, with the staged rows.
 */
@Injectable()
export class RotationService {
  private readonly rotators = new Map<SectionName, SectionRotator>();
  private readonly log = new Logger(RotationService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly crypto: CryptoService,
    private readonly sectionKeys: SectionKeysService,
    private readonly settings: SettingsRepository,
    private readonly rotation: RotationRepository,
    private readonly guard: SectionWriteGuard,
    notes: NotesService,
    apis: ApiKeysService,
    counts: CountsService,
  ) {
    for (const rotator of [...notes.rotators, ...apis.rotators, ...counts.rotators]) {
      this.rotators.set(rotator.section, rotator);
    }
  }

  /**
   * Starts the rotation of a section or resumes the job already open for it. Every guard
   * runs before anything is staged; the staging phase itself moves to the background, so
   * the live section keeps answering to `current` until the swap commits.
   */
  async start(
    section: string,
    current: string,
    next: string,
  ): Promise<RotationStarted | RotationApplied> {
    if (!this.isSection(section)) throw new BadRequestException('invalid section');
    this.assertRequest(current, next);

    const name = section;
    const live = await this.readCanary(name);
    if (!this.auth.isSectionUnlocked(name)) {
      throw new UnauthorizedException('section is locked; unlock it before rotating it');
    }

    const open = await this.rotation.findOpenJob(name);

    // A job the process left applying is settled by the live canary: either the swap
    // committed (the new passphrase matches it) or it did not and the staged rows remain.
    if (open?.status === 'applying' && (await this.crypto.verifyCanary(next, name, live))) {
      await this.finish(name, next, open.id);
      return { ok: true, section: name, staged: 0 };
    }

    if (!(await this.crypto.verifyCanary(current, name, live))) {
      throw new UnauthorizedException('current passphrase does not match this section');
    }

    // Resuming verifies `next` against the pending canary: the live one is still the old key.
    const pending = open?.pendingCanary as CanaryData | undefined;
    if (pending && !(await this.crypto.verifyCanary(next, name, pending))) {
      throw new UnauthorizedException('next passphrase does not match the pending rotation');
    }

    const job = open ?? (await this.newJob(name, next));
    if (open && open.status !== 'staging') await this.rotation.markStatus(open.id, 'staging');

    const rotator = this.rotators.get(name);
    if (!rotator || job.total === 0) {
      // `vault` keeps no data and an empty section has nothing to stage: the swap is all there is.
      const staged = await this.applyJob(name, job.id, next);
      return { ok: true, section: name, staged };
    }

    this.guard.open(name);
    void this.stageInBackground(name, job.id, current, next);
    return { jobId: job.id, status: 'staging', total: job.total };
  }
  /** Progress of the open job, or of the last one that ended without cleanup. */
  async status(section: string): Promise<RotationProgress> {
    if (!this.isSection(section)) throw new BadRequestException('invalid section');
    const name = section;
    const job = (await this.rotation.findOpenJob(name)) ?? (await this.rotation.findLatestJob(name));
    if (!job) return { status: 'done', total: 0, processed: 0 };
    return {
      status: job.status,
      total: job.total,
      processed: job.processed,
      ...(job.error ? { error: job.error } : {}),
    };
  }

  /** Rollback: staging and the job go, and nothing live was ever touched. */
  async cancel(section: string): Promise<{ ok: true; discarded: number }> {
    if (!this.isSection(section)) throw new BadRequestException('invalid section');
    const name = section;
    const open = await this.rotation.findOpenJob(name);
    if (!open) throw new ConflictException('no open rotation for this section');

    const discarded = await this.rotation.clearStaging(open.id);
    await this.rotation.deleteJob(open.id);
    this.sectionKeys.evict(name);
    this.guard.close(name);
    this.log.log(`rotacion de ${name} cancelada`, { section: name });
    return { ok: true, discarded };
  }

  // ============ STAGING / APPLY ============

  /**
   * The long phase. It never writes to the domain tables: it stages durable units and then
   * hands them to the apply step. A lock or an expired unlock TTL pauses the job instead of
   * failing it, because the staged units survive and a resume re-supplies both passphrases.
   */
  private async stageInBackground(
    section: SectionName,
    jobId: string,
    current: string,
    next: string,
  ): Promise<void> {
    try {
      const rotator = this.rotators.get(section);
      if (!rotator) return;

      const staged = await rotator.stage(jobId, current, next, (processed) =>
        this.rotation.updateProgress(jobId, processed),
      );
      await this.rotation.updateProgress(jobId, await this.rotation.countStaged(jobId));

      if (!this.auth.isSectionUnlocked(section)) {
        await this.rotation.markStatus(jobId, 'interrupted');
        this.log.warn(`rotacion de ${section} en pausa: seccion bloqueada`, { section });
        return;
      }

      await this.applyJob(section, jobId, next);
      this.log.log(`rotacion de ${section} preparada (${staged} unidades)`, { section });
    } catch (err) {
      await this.failJob(section, jobId, err);
    }
  }

  /**
   * The atomic point: the new canary, every staged row and the job status commit together
   * or not at all, so a blackout leaves the section fully old or fully new, never mixed.
   */
  private async applyJob(section: SectionName, jobId: string, next: string): Promise<number> {
    await this.rotation.markStatus(jobId, 'applying');
    const canary = this.asRecord(await this.crypto.createCanary(next, section));
    const rotator = this.rotators.get(section);

    const applied = await this.rotation.applyStaged(jobId, async (tx, staged) => {
      await this.settings.upsertInTx(tx, `${section}.canary`, canary);
      return rotator ? rotator.apply(tx, staged) : 0;
    });

    await this.finish(section, next, jobId);
    return applied;
  }
/**
   * Cleanup after the swap committed: the caches that could still hold the previous key go,
   * the session keeps working under the new passphrase, the write window closes and the job
   * row disappears - the live canary is what describes the state from here on.
   */
  private async finish(section: SectionName, next: string, jobId: string): Promise<void> {
    this.sectionKeys.evict(section);
    this.auth.swapSectionPassphrase(section, next);
    this.guard.close(section);
    await this.rotation.deleteJob(jobId);
    this.log.log(`rotacion de ${section} aplicada`, { section });
  }

  /** Staging failed: the job is reported and its staged rows dropped; nothing live changed. */
  private async failJob(section: SectionName, jobId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.rotation.markStatus(jobId, 'failed', message);
    await this.rotation.clearStaging(jobId);
    this.guard.close(section);
    this.log.error(`rotacion de ${section} fallida: ${message}`, { section });
  }

  // ============ HELPERS ============

  /**
   * Fresh job: `total` comes from the rotator and the pending canary is the resume verifier.
   */
  private async newJob(section: SectionName, next: string): Promise<RotationJobRow> {
    await this.rotation.deleteClosedJobs(section);
    const total = (await this.rotators.get(section)?.countUnits()) ?? 0;
    const pending = this.asRecord(await this.crypto.createCanary(next, section));
    const job = await this.rotation.createJob(section, total, pending);
    this.log.log(`rotacion de ${section} iniciada`, { section, total });
    return job;
  }

  /** The canary travels through settings as jsonb, never as a class. */
  private asRecord(value: unknown): Record<string, unknown> {
    return value as Record<string, unknown>;
  }

  private async readCanary(section: SectionName): Promise<CanaryData> {
    const row = await this.settings.findByKey(`${section}.canary`);
    if (!row) {
      throw new ConflictException(
        `${section} has no passphrase configured; use set-passphrase first`,
      );
    }
    return row.value as CanaryData;
  }

  private isSection(section: string): section is SectionName {
    return this.auth.validSection(section);
  }

  private assertRequest(current: string, next: string): void {
    if (!current) throw new BadRequestException('current passphrase is required');
    if (typeof next !== 'string' || next.length < MIN_PASSPHRASE_LENGTH) {
      throw new BadRequestException(
        `next passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`,
      );
    }
    if (next === current) {
      throw new BadRequestException('next passphrase must differ from current');
    }
  }
}
