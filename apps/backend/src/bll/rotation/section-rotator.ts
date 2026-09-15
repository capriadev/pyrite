import type { DrizzleTx } from '../../dal/drizzle.provider';
import type { RotationStagingRow } from '../../dal/rotation/rotation.repository';
import type { SectionName } from '../../services/crypto/crypto-config';

/**
 * A section that can be rotated. The orchestrator owns the job, the states, the canary
 * swap and the write window; the rotator owns the domain knowledge: which rows carry
 * ciphertext, which key decrypts each one and which columns hold ciphertext, iv and tag.
 *
 * Staged units use the DAL `StagedWrite` shape (`target_table` + jsonb payload), so the
 * apply step is shared: the orchestrator only hands the staged rows back to the rotator.
 */
/** Reports staged units so the job progress is never behind the work it describes. */
export type StageReporter = (processed: number) => Promise<void>;

export interface SectionRotator {
  readonly section: SectionName;

  /**
   * Work units the section stages (rows; in `counts` the unit is the account plus one per
   * history row). Drives the job `total` and the progress report.
   */
  countUnits(): Promise<number>;

  /**
   * Decrypts every pending unit with `from`, re-encrypts it with `to` and stages it under
   * `jobId`. Units already staged for that job are skipped, so calling it again resumes the
   * work instead of redoing it. Never writes to the domain tables: that happens in `apply`.
   *
   * @param report called as units land, so a long section reports progress while it stages.
   * @returns units staged in this pass.
   */
  stage(jobId: string, from: string, to: string, report: StageReporter): Promise<number>;

  /**
   * Copies the staged payloads into their live columns inside `tx`, which the orchestrator
   * commits together with the new canary and the job status. Must not open its own
   * transaction, and must be safe to run twice over the same rows (last write wins).
   *
   * @returns units applied.
   */
  apply(tx: DrizzleTx, staged: RotationStagingRow[]): Promise<number>;
}
