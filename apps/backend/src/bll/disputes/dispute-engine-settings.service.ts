import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  AUTO_LINK_KEY,
  AUTO_LINK_MARGIN_KEY,
  AUTO_LINK_MIN_SCORE_KEY,
  DISPUTES_ENABLED_KEY,
  REVIEW_THRESHOLD_KEY,
  SUGGESTION_AGE_KEY,
  TOLERANCE_AFTER_KEY,
  TOLERANCE_BEFORE_KEY,
  autoLinkConfig,
  disputesEnabled,
  matcherConfig,
  suggestionAgeDays,
} from './dispute-settings';

/** Effective values of the engine settings, as the panel shows them. */
export interface EngineSettings {
  enabled: boolean;
  toleranceBefore: number;
  toleranceAfter: number;
  reviewThresholdPercent: number;
  autoLink: boolean;
  autoLinkMinScore: number;
  autoLinkMargin: number;
  suggestionAgeDays: number;
}

/**
 * The settings surface of the engine (spec 022). It reads the defaults through the shared
 * helpers, so what the panel shows and what a run uses can never drift apart, and it validates
 * every patch before it is stored: a tolerance of -1 would silently break the windows.
 */
@Injectable()
export class DisputeEngineSettingsService {
  private readonly log = new Logger(DisputeEngineSettingsService.name);

  constructor(private readonly settings: SettingsService) {}

  /** What the settings screen shows. */
  current(): EngineSettings {
    const matcher = matcherConfig(this.settings);
    const auto = autoLinkConfig(this.settings);
    return {
      enabled: disputesEnabled(this.settings),
      toleranceBefore: matcher.toleranceBefore,
      toleranceAfter: matcher.toleranceAfter,
      reviewThresholdPercent: matcher.reviewThresholdPercent,
      autoLink: auto.enabled,
      autoLinkMinScore: auto.minScore,
      autoLinkMargin: auto.margin,
      suggestionAgeDays: suggestionAgeDays(this.settings),
    };
  }

  /** Only the keys present change; every value is validated here, never at the run. */
  async update(patch: Record<string, unknown>): Promise<EngineSettings> {
    const writes: Array<[string, unknown]> = [];
    if (patch.enabled !== undefined) writes.push([DISPUTES_ENABLED_KEY, this.boolean(patch.enabled, 'enabled')]);
    if (patch.autoLink !== undefined) writes.push([AUTO_LINK_KEY, this.boolean(patch.autoLink, 'autoLink')]);
    if (patch.toleranceBefore !== undefined) {
      writes.push([TOLERANCE_BEFORE_KEY, this.counter(patch.toleranceBefore, 'toleranceBefore')]);
    }
    if (patch.toleranceAfter !== undefined) {
      writes.push([TOLERANCE_AFTER_KEY, this.counter(patch.toleranceAfter, 'toleranceAfter')]);
    }
    if (patch.reviewThresholdPercent !== undefined) {
      writes.push([REVIEW_THRESHOLD_KEY, this.counter(patch.reviewThresholdPercent, 'reviewThresholdPercent', 100)]);
    }
    if (patch.autoLinkMinScore !== undefined) {
      writes.push([AUTO_LINK_MIN_SCORE_KEY, this.counter(patch.autoLinkMinScore, 'autoLinkMinScore', 100)]);
    }
    if (patch.autoLinkMargin !== undefined) {
      writes.push([AUTO_LINK_MARGIN_KEY, this.counter(patch.autoLinkMargin, 'autoLinkMargin', 100)]);
    }
    if (patch.suggestionAgeDays !== undefined) {
      writes.push([SUGGESTION_AGE_KEY, this.counter(patch.suggestionAgeDays, 'suggestionAgeDays', 365)]);
    }
    for (const [key, value] of writes) await this.settings.set(key, value);
    if (writes.length > 0) this.log.log(`Engine settings updated: ${writes.map(([key]) => key).join(', ')}`);
    return this.current();
  }

  private boolean(value: unknown, label: string): boolean {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException(`${label} must be a boolean`);
  }

  private counter(value: unknown, label: string, max = 365): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      throw new BadRequestException(`${label} must be an integer between 0 and ${max}`);
    }
    return parsed;
  }
}
