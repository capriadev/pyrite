import type { SettingsService } from '../settings/settings.service';
import { DEFAULT_MATCHER_CONFIG, type MatcherConfig } from './dispute-matcher';

/**
 * Settings of the dispute engine, with their defaults in one place. Keys follow the
 * namespaced convention of the settings table (`counts.stale_days`, `agent.provider`).
 */
export const DISPUTES_ENABLED_KEY = 'disputes.enabled';
export const TOLERANCE_BEFORE_KEY = 'disputes.tolerance_before';
export const TOLERANCE_AFTER_KEY = 'disputes.tolerance_after';
export const REVIEW_THRESHOLD_KEY = 'disputes.amount_tolerance_percent';

/** The engine runs unless it was explicitly parked. */
export function disputesEnabled(settings: SettingsService): boolean {
  const value = settings.get(DISPUTES_ENABLED_KEY);
  return value === undefined || value === null ? true : value === true || value === 'true';
}

/** Tolerances are dual by design: paying before and paying late are not symmetric. */
export function matcherConfig(settings: SettingsService): MatcherConfig {
  return {
    toleranceBefore: positiveInt(settings.get(TOLERANCE_BEFORE_KEY), DEFAULT_MATCHER_CONFIG.toleranceBefore),
    toleranceAfter: positiveInt(settings.get(TOLERANCE_AFTER_KEY), DEFAULT_MATCHER_CONFIG.toleranceAfter),
    reviewThresholdPercent: positiveInt(
      settings.get(REVIEW_THRESHOLD_KEY),
      DEFAULT_MATCHER_CONFIG.reviewThresholdPercent,
    ),
  };
}

/** A setting that is not a positive number falls back to its default instead of breaking a run. */
function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}
