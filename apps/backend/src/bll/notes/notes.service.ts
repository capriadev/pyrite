import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { NotesRepository, type NoteRow } from '../../dal/notes/notes.repository';
import { SettingsRepository } from '../../dal/settings/settings.repository';
import { CryptoService } from '../../services/crypto/crypto.service';
import { AuthService } from '../auth/auth.service';
import { GroupsService } from '../groups/groups.service';

const SALT_KEYS: Record<string, string> = {
  notes: 'notes.salt',
  notes_private: 'notes_private.salt',
};

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
   * Derived keys cached while each section is unlocked (shared salt).
   * Cache is only served after re-validating the lock against AuthService,
   * which is the single source of truth for unlock state.
   */
  private sectionKeys = new Map<'notes' | 'notes_private', Buffer>();

  constructor(
    private readonly repo: NotesRepository,
    private readonly settings: SettingsRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly groups: GroupsService,
  ) {}

  private isUnlocked(section: 'notes' | 'notes_private'): boolean {
    return this.auth.isSectionUnlocked(section);
  }

  private async deriveSectionKey(section: 'notes' | 'notes_private'): Promise<Buffer> {
    if (!this.isUnlocked(section)) {
      this.sectionKeys.delete(section);
      throw new ForbiddenException(`${section} section is locked`);
    }
    const cached = this.sectionKeys.get(section);
    if (cached) return cached;
    const passphrase = this.auth.getSectionPassphrase(section);
    if (!passphrase) {
      this.sectionKeys.delete(section);
      throw new ForbiddenException(`${section} section is locked`);
    }
    const saltKey = SALT_KEYS[section];
    const saltRow = await this.settings.findByKey(saltKey);
    let salt: Buffer;
    if (saltRow) {
      salt = Buffer.from(saltRow.value as string, 'base64');
    } else {
      salt = randomBytes(16);
      await this.settings.upsert(saltKey, salt.toString('base64'));
    }
    const key = await this.crypto.deriveKey(passphrase, section, salt);
    this.sectionKeys.set(section, key);
    return key;
  }

  // ============ CREATE / READ ============

  async create(input: CreateNoteInput): Promise<NoteListItem> {
    const section = input.isPrivate ? 'notes_private' : 'notes';
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
    return this.toListItem(row, input.content);
  }

  async list(): Promise<NoteListItem[]> {
    const rows = await this.repo.findActive();
    const results: NoteListItem[] = [];
    for (const row of rows) {
      const section = row.isPrivate === 'true' ? 'notes_private' : 'notes';
      if (!this.isUnlocked(section)) {
        this.sectionKeys.delete(section);
        results.push(this.toListItem(row, '', true));
        continue;
      }
      try {
        const key = await this.deriveSectionKey(section);
        const content = this.crypto.decrypt(this.toEncrypted(row), key, Buffer.from(row.id));
        results.push(this.toListItem(row, content));
      } catch {
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
    const content = this.crypto.decrypt(this.toEncrypted(row), key, Buffer.from(row.id));
    await this.repo.touchAccessed(id);
    return { content };
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
      } catch {
        // skip undecryptable in search
      }
    }
    return results;
  }

  // ============ ITEM OPS ============

  async updateContent(id: string, content: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    const section = row.isPrivate === 'true' ? 'notes_private' : 'notes';
    const key = await this.deriveSectionKey(section);
    const encrypted = this.crypto.encrypt(content, key, Buffer.from(row.id));
    await this.repo.update(id, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
  }

  async updateMeta(id: string, meta: { title?: string; groupId?: string | null; pinned?: boolean }): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    const patch: Record<string, unknown> = {};
    if (meta.title !== undefined) patch.title = meta.title;
    if (meta.groupId !== undefined) patch.groupId = meta.groupId ?? null;
    if (meta.pinned !== undefined) patch.pinned = meta.pinned ? 'true' : 'false';
    await this.repo.update(id, patch);
  }

  async setPrivate(id: string, isPrivate: boolean): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('note not found');
    const target = isPrivate ? 'notes_private' : 'notes';
    const key = await this.deriveSectionKey(target);
    const { content } = await this.getContent(id);
    const encrypted = this.crypto.encrypt(content, key, Buffer.from(row.id));
    await this.repo.update(id, {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      isPrivate: isPrivate ? 'true' : 'false',
    });
  }

  async remove(id: string): Promise<void> {
    await this.repo.softDelete(id);
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

  // ============ HELPERS ============

  private toEncrypted(row: NoteRow): { ciphertext: string; iv: string; authTag: string; salt: string } {
    return { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt };
  }

  private toListItem(row: NoteRow, content: string, snippetOrHidden?: string | boolean): NoteListItem {
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