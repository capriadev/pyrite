import type { SettingsService } from '../settings/settings.service';
import { DEFAULT_MATCHER_CONFIG, type MatcherConfig } from './dispute-matcher';
import { DEFAULT_AUTO_LINK, type AutoLinkConfig } from './dispute-scorer';

/**
 * Settings of the dispute engine, with their defaults in one place. Keys follow the
 * namespaced convention of the settings table (`counts.stale_days`, `agent.provider`).
 */
export const DISPUTES_ENABLED_KEY = 'disputes.enabled';
export const TOLERANCE_BEFORE_KEY = 'disputes.tolerance_before';
export const TOLERANCE_AFTER_KEY = 'disputes.tolerance_after';
export const REVIEW_THRESHOLD_KEY = 'disputes.amount_tolerance_percent';
export const AUTO_LINK_KEY = 'disputes.auto_link';
export const AUTO_LINK_MIN_SCORE_KEY = 'disputes.auto_link_min_score';
export const AUTO_LINK_MARGIN_KEY = 'disputes.auto_link_margin';
export const SUGGESTION_AGE_KEY = 'disputes.suggestion_age_days';

export const DEFAULT_SUGGESTION_AGE_DAYS = 14;

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

/**
 * The auto-link gate. Off by default: the engine's posture is to consult, and whoever wants
 * the differential turns it on.
 */
export function autoLinkConfig(settings: SettingsService): AutoLinkConfig {
  const value = settings.get(AUTO_LINK_KEY);
  return {
    enabled: value === true || value === 'true',
    minScore: positiveInt(settings.get(AUTO_LINK_MIN_SCORE_KEY), DEFAULT_AUTO_LINK.minScore),
    margin: positiveInt(settings.get(AUTO_LINK_MARGIN_KEY), DEFAULT_AUTO_LINK.margin),
  };
}

/** How long an unanswered consultation waits before it falls to a missing dispute. */
export function suggestionAgeDays(settings: SettingsService): number {
  // Zero is a legitimate value: it means a consultation does not wait at all.
  return positiveInt(settings.get(SUGGESTION_AGE_KEY), DEFAULT_SUGGESTION_AGE_DAYS);
}

/** A setting that is not a positive number falls back to its default instead of breaking a run. */
function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

