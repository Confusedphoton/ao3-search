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
      theme: 'system',
      expansionPolicy: 'topological',
      permeability: DEFAULT_SETTINGS.permeability,
    });
  });

  it('accepts valid overrides', () => {
    expect(
      normalizeSettings({
        topResults: 40,
        maxSeeds: 10,
        maxNegativeSeeds: 5,
        negativeRelevanceLambda: 1.5,
        theme: 'dark',
        expansionPolicy: 'topological',
      }),
    ).toEqual({
      topResults: 40,
      maxSeeds: 10,
      maxNegativeSeeds: 5,
      negativeRelevanceLambda: 1.5,
      theme: 'dark',
      expansionPolicy: 'topological',
      permeability: DEFAULT_SETTINGS.permeability,
    });
  });

  it('falls back to topological for invalid expansion policy', () => {
    expect(normalizeSettings({ expansionPolicy: 'beam' }).expansionPolicy).toBe('topological');
  });

  it('accepts topo-query expansion policy', () => {
    expect(normalizeSettings({ expansionPolicy: 'topo-query' }).expansionPolicy).toBe(
      'topo-query',
    );
  });

  it('falls back to system theme for invalid values', () => {
    expect(normalizeSettings({ theme: 'neon' }).theme).toBe('system');
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
  });

  it('normalizes permeability filters', () => {
    const settings = normalizeSettings({
      permeability: {
        rating: {
          mode: 'whitelist',
          permeability: 1.5,
          values: ['Explicit', 'Explicit', 'Not A Real Rating'],
        },
        language: {
          mode: 'blacklist',
          permeability: -1,
          values: [' English ', '', 'English'],
        },
        fandoms: {
          mode: 'nope',
          permeability: 0.25,
          values: ['Harry Potter'],
        },
      },
    });

    expect(settings.permeability.rating).toEqual({
      mode: 'whitelist',
      permeability: 1,
      values: ['Explicit'],
    });
    expect(settings.permeability.language).toEqual({
      mode: 'blacklist',
      permeability: 0,
      values: ['English'],
    });
    expect(settings.permeability.fandoms).toEqual({
      mode: 'blacklist',
      permeability: 0.25,
      values: ['Harry Potter'],
    });
    expect(settings.permeability.categories).toEqual(DEFAULT_SETTINGS.permeability.categories);
  });

  it('keeps completion status as an exclusive single value', () => {
    const settings = normalizeSettings({
      permeability: {
        completionStatus: {
          mode: 'whitelist',
          permeability: 0,
          values: ['Complete', 'Incomplete'],
        },
      },
    });

    expect(settings.permeability.completionStatus.values).toEqual(['Complete']);
  });
});
