import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  NotesRepository,
  type NoteRewrite,
  type NoteRow,
} from '../../dal/notes/notes.repository';
import { RotationRepository, type RotationStagingRow } from '../../dal/rotation/rotation.repository';
import type { DrizzleTx } from '../../dal/drizzle.provider';
import { CryptoService } from '../../services/crypto/crypto.service';
import { SectionKeysService } from '../../services/crypto/section-keys';
import { AuthService } from '../auth/auth.service';
import { GroupsService } from '../groups/groups.service';
import { SectionWriteGuard } from '../rotation/section-write-guard';
import type { SectionRotator, StageReporter } from '../rotation/section-rotator';

/** Physical table both note sections write to; the private flag is what picks the key. */
const NOTES_TABLE = 'notes';

/** Columns of a staged unit: everything the apply writes back except the row id. */
type NotePayload = Omit<NoteRewrite, 'id'>;

export interface CreateNoteInput {
  title: string;
  content: string;
  groupId?: string | null;
  isPrivate?: boolean;
  pinned?: boolean;
}

export interface NoteListItem {
  id: string;
  title: string;
  snippet: string;
  isPrivate: boolean;
  pinned: boolean;
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

@Injectable()
export class NotesService {
  /**
   * `notes` and `notes_private` as rotators (spec 013). Both sections share one table, so
   * each one walks the rows that carry its own flag: rotating notes never touches the
   * private rows and the other way around.
   */
  readonly rotators: SectionRotator[] = [
    {
      section: 'notes',
      countUnits: () => this.countUnits('notes'),
      stage: (jobId, from, to, report) => this.stageSection(jobId, 'notes', from, to, report),
      apply: (tx, staged) => this.applySection(tx, staged),
    },
    {
      section: 'notes_private',
      countUnits: () => this.countUnits('notes_private'),
      stage: (jobId, from, to, report) =>
        this.stageSection(jobId, 'notes_private', from, to, report),
      apply: (tx, staged) => this.applySection(tx, staged),
    },
  ];

  private readonly log = new Logger(NotesService.name);

  constructor(
    private readonly repo: NotesRepository,
    private readonly rotation: RotationRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly keys: SectionKeysService,
    private readonly guard: SectionWriteGuard,
    private readonly groups: GroupsService,
  ) {}

  private isUnlocked(section: 'notes' | 'notes_private'): boolean {
    return this.auth.isSectionUnlocked(section);
  }

  /**
   * Key of a section, through the shared key module (one derivation for the whole section,
   * cached per passphrase). A missing unlock state drops the entry instead of serving it.
   */
  private async deriveSectionKey(section: 'notes' | 'notes_private'): Promise<Buffer> {
    const passphrase = this.auth.getSectionPassphrase(section);
    if (!passphrase) {
      this.keys.evict(section);
      throw new ForbiddenException(`${section} section is locked`);
    }
    return this.keys.sectionKey(passphrase, section);
  }
  // ============ CREATE / READ ============

  async create(input: CreateNoteInput): Promise<NoteListItem> {
    const section = input.isPrivate ? 'notes_private' : 'notes';
    this.guard.assertWritable(section);
    const key = await this.deriveSectionKey(section);
    const id = randomUUID();
    const encrypted = this.crypto.encrypt(input.content, key, Buffer.from(id));
    const row = await this.repo.create({
      id,
      title: input.title,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: key.toString('base64'),
      isPrivate: input.isPrivate ? 'true' : 'false',
      pinned: input.pinned ? 'true' : 'false',
      groupId: input.groupId ?? null,
    });
    this.log.log('nota creada', { noteId: id, section, groupId: input.groupId ?? null });
    return this.toListItem(row, input.content);
  }

  async list(): Promise<NoteListItem[]> {
    const rows = await this.repo.findActive();
    const results: NoteListItem[] = [];
    for (const row of rows) {
      const section = row.isPrivate === 'true' ? 'notes_private' : 'notes';
      if (!this.isUnlocked(section)) {
        results.push(this.toListItem(row, '', true));
        continue;
      }
      try {
        const key = await this.deriveSectionKey(section);
        const content = this.crypto.decrypt(this.toEncrypted(row), key, Buffer.from(row.id));
        results.push(this.toListItem(row, content));
      } catch (err: unknown) {
        this.log.warn(
          `nota ${row.id} no se pudo descifrar en list: ${err instanceof Error ? err.message : err}`,
          { noteId: row.id, section },
        );
        results.push(this.toListItem(row, '', true));
      }
    }
    return results;
  }

  async getContent(id: string): Promise<{ content: string }> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    const section = row.isPrivate === 'true' ? 'notes_private' : 'notes';
    const key = await this.deriveSectionKey(section);
    try {
      const content = this.crypto.decrypt(this.toEncrypted(row), key, Buffer.from(row.id));
      await this.repo.touchAccessed(id);
      return { content };
    } catch (err: unknown) {
      this.log.error(
        `descifrado de la nota ${id} fallo: ${err instanceof Error ? err.message : err}`,
        { noteId: id, section },
      );
      throw err;
    }
  }

  // ============ SEARCH ============

  async search(query: string, opts: { privateOnly?: boolean } = {}): Promise<NoteListItem[]> {
    const q = query.toLowerCase();
    const rows = await this.repo.findActive();
    const results: NoteListItem[] = [];
    for (const row of rows) {
      const section = row.isPrivate === 'true' ? 'notes_private' : 'notes';
      const isPrivate = section === 'notes_private';
      if (opts.privateOnly && !isPrivate) continue;
      if (!this.isUnlocked(section)) continue;
      if (row.title.toLowerCase().includes(q)) {
        results.push(this.toListItem(row, '', row.title));
        continue;
      }
      try {
        const key = await this.deriveSectionKey(section);
        const content = this.crypto.decrypt(this.toEncrypted(row), key, Buffer.from(row.id));
        if (content.toLowerCase().includes(q)) {
          results.push(this.toListItem(row, content));
        }
      } catch (err: unknown) {
        this.log.warn(
          `nota ${row.id} no se pudo descifrar en search: ${err instanceof Error ? err.message : err}`,
          { noteId: row.id, section },
        );
      }
    }
    return results;
  }

    // ============ ITEM OPS ============

  async updateContent(id: string, content: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    const section = row.isPrivate === 'true' ? 'notes_private' : 'notes';
    this.guard.assertWritable(section);
    const key = await this.deriveSectionKey(section);
    const encrypted = this.crypto.encrypt(content, key, Buffer.from(row.id));
    await this.repo.update(id, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
    this.log.log(`contenido de la nota ${id} actualizado`, { noteId: id, section });
  }

  async updateMeta(
    id: string,
    meta: { title?: string; groupId?: string | null; pinned?: boolean },
  ): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    this.guard.assertWritable(row.isPrivate === 'true' ? 'notes_private' : 'notes');
    const patch: Record<string, unknown> = {};
    if (meta.title !== undefined) patch.title = meta.title;
    if (meta.groupId !== undefined) patch.groupId = meta.groupId ?? null;
    if (meta.pinned !== undefined) patch.pinned = meta.pinned ? 'true' : 'false';
    await this.repo.update(id, patch);
    this.log.log(`metadatos de la nota ${id} actualizados`, {
      noteId: id,
      fields: Object.keys(patch),
    });
  }

  async setPrivate(id: string, isPrivate: boolean): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    const from = row.isPrivate === 'true' ? 'notes_private' : 'notes';
    const target = isPrivate ? 'notes_private' : 'notes';
    this.guard.assertWritable(from);
    this.guard.assertWritable(target);
    const key = await this.deriveSectionKey(target);
    const { content } = await this.getContent(id);
    const encrypted = this.crypto.encrypt(content, key, Buffer.from(row.id));
    await this.repo.update(id, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      isPrivate: isPrivate ? 'true' : 'false',
    });
    this.log.log(`nota ${id} movida a ${target}`, { noteId: id, section: target });
  }

  async remove(id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    this.guard.assertWritable(row.isPrivate === 'true' ? 'notes_private' : 'notes');
    await this.repo.softDelete(id);
    this.log.log(`nota ${id} eliminada (soft)`, { noteId: id });
  }

  // ============ GROUPS (delegated) ============

  listGroups() {
    return this.groups.list('notes');
  }

  createGroup(name: string) {
    return this.groups.create('notes', name);
  }

  removeGroup(id: string): Promise<void> {
    return this.groups.remove('notes', id);
  }

  // ============ ROTATION (spec 013) ============

  /** One unit per row of the section: the whole section shares a key, so it stages in one pass. */
  private async countUnits(section: 'notes' | 'notes_private'): Promise<number> {
    return (await this.repo.findForRotation(section === 'notes_private')).length;
  }

  /**
   * Decrypts each row with `from`, encrypts it with `to` and stages the result together with
   * the refreshed copy of the section key. Live rows are untouched: the section keeps
   * answering to the old passphrase until the apply commits. Rows already staged are skipped,
   * which is what makes a resume reuse the work instead of redoing it.
   */
  private async stageSection(
    jobId: string,
    section: 'notes' | 'notes_private',
    from: string,
    to: string,
    report: StageReporter,
  ): Promise<number> {
    const rows = await this.repo.findForRotation(section === 'notes_private');
    if (rows.length === 0) return 0;

    const already = await this.stagedNoteIds(jobId);
    const oldKey = await this.keys.deriveSectionKey(from, section);
    const newKey = await this.keys.deriveSectionKey(to, section);
    const salt = newKey.toString('base64');

    let staged = 0;
    for (const row of rows) {
      if (already.has(row.id)) continue;
      const content = this.crypto.decrypt(this.toEncrypted(row), oldKey, Buffer.from(row.id));
      const encrypted = this.crypto.encrypt(content, newKey, Buffer.from(row.id));
      await this.rotation.stageRow(jobId, {
        targetTable: NOTES_TABLE,
        rowId: row.id,
        payload: {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          salt,
        },
      });
      staged += 1;
    }

    if (staged > 0) await report(staged);
    return staged;
  }

  /** Write-back inside the apply transaction: ciphertext, iv, tag and the new key copy. */
  private async applySection(tx: DrizzleTx, staged: RotationStagingRow[]): Promise<number> {
    const rows: NoteRewrite[] = staged
      .filter((row) => row.targetTable === NOTES_TABLE)
      .map((row) => ({ id: row.rowId, ...(row.payload as NotePayload) }));
    return this.repo.applyRotation(tx, rows);
  }

  /** Rows already staged for this job, so a resume never re-derives what is already durable. */
  private async stagedNoteIds(jobId: string): Promise<Set<string>> {
    const staged = await this.rotation.listStaged(jobId);
    return new Set(staged.filter((row) => row.targetTable === NOTES_TABLE).map((row) => row.rowId));
  }

  // ============ HELPERS ============

  private toEncrypted(row: NoteRow): {
    ciphertext: string;
    iv: string;
    authTag: string;
    salt: string;
  } {
    return { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt };
  }

  private toListItem(
    row: NoteRow,
    content: string,
    snippetOrHidden?: string | boolean,
  ): NoteListItem {
    const hidden = snippetOrHidden === true;
    const snippet = hidden
      ? ''
      : typeof snippetOrHidden === 'string'
        ? snippetOrHidden
        : this.makeSnippet(content);
    return {
      id: row.id,
      title: row.title,
      snippet,
      isPrivate: row.isPrivate === 'true',
      pinned: row.pinned === 'true',
      groupId: row.groupId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastAccessedAt: row.lastAccessedAt,
    };
  }

  private makeSnippet(content: string): string {
    const clean = content.replace(/\s+/g, ' ').trim();
    return clean.length > 80 ? clean.slice(0, 80) + '...' : clean;
  }
}
