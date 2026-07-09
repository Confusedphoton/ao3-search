import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  SETTINGS_BOUNDS,
} from '@/src/config/settings';

describe('normalizeSettings', () => {
  it('returns defaults for empty input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps out-of-range values', () => {
    expect(
      normalizeSettings({
        topResults: 0,
        maxSeeds: 999,
        maxNegativeSeeds: -3,
        negativeRelevanceLambda: 100,
      }),
    ).toEqual({
      topResults: SETTINGS_BOUNDS.topResults.min,
      maxSeeds: SETTINGS_BOUNDS.maxSeeds.max,
      maxNegativeSeeds: SETTINGS_BOUNDS.maxNegativeSeeds.min,
      negativeRelevanceLambda: SETTINGS_BOUNDS.negativeRelevanceLambda.max,
    });
  });

  it('accepts valid overrides', () => {
    expect(
      normalizeSettings({
        topResults: 40,
        maxSeeds: 10,
        maxNegativeSeeds: 5,
        negativeRelevanceLambda: 1.5,
      }),
    ).toEqual({
      topResults: 40,
      maxSeeds: 10,
      maxNegativeSeeds: 5,
      negativeRelevanceLambda: 1.5,
    });
  });
});
