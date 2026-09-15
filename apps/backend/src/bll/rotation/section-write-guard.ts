import { ConflictException, Injectable } from '@nestjs/common';
import type { SectionName } from '../../services/crypto/crypto-config';

/**
 * Blocks writes against a section while a rotation job has it in staging. Reads keep
 * working (the staging pass needs to read), and the window closes when the apply
 * commits or the job is cancelled. Rebuilt from scratch on restart: a job left in
 * staging is marked interrupted at boot, so a restart does not lock a section forever.
 */
@Injectable()
export class SectionWriteGuard {
  private readonly locked = new Set<SectionName>();

  open(section: SectionName): void {
    this.locked.add(section);
  }

  close(section: SectionName): void {
    this.locked.delete(section);
  }

  isOpen(section: SectionName): boolean {
    return this.locked.has(section);
  }

  /** Called by every write path of a section before touching its rows. */
  assertWritable(section: SectionName): void {
    if (this.locked.has(section)) {
      throw new ConflictException(
        `${section} is locked by a rotation job; retry once it finishes or is cancelled`,
      );
    }
  }
}
