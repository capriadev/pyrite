import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { SettingsRepository } from '../dal/settings.repository';

/**
 * System settings domain. Loads the full settings table into memory at boot
 * and serves get/set from there; mutations persist to DB and update memory.
 * Kept in sync as the single runtime source for user-facing config.
 */
@Injectable()
export class SettingsService implements OnApplicationBootstrap {
  private cache = new Map<string, unknown>();

  constructor(private readonly repo: SettingsRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.repo.findAll();
    this.cache = new Map(rows.map((r) => [r.key, r.value]));
  }

  get(key: string): unknown {
    return this.cache.get(key);
  }

  all(): Array<{ key: string; value: unknown }> {
    return [...this.cache.entries()].map(([key, value]) => ({ key, value }));
  }

  async set(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    await this.repo.upsert(key, value);
    await this.refresh();
    return { key, value };
  }
}