import {
  MAX_NEGATIVE_SEEDS,
  MAX_SEEDS,
  MIN_SEEDS,
  NEGATIVE_RELEVANCE_LAMBDA,
  TOP_RESULTS,
} from './constants';

export const SETTINGS_STORAGE_KEY = 'tunableSettings';

export interface TunableSettings {
  topResults: number;
  maxSeeds: number;
  maxNegativeSeeds: number;
  negativeRelevanceLambda: number;
}

export const DEFAULT_SETTINGS: TunableSettings = {
  topResults: TOP_RESULTS,
  maxSeeds: MAX_SEEDS,
  maxNegativeSeeds: MAX_NEGATIVE_SEEDS,
  negativeRelevanceLambda: NEGATIVE_RELEVANCE_LAMBDA,
};

/** Inclusive bounds used when normalizing stored or form values. */
export const SETTINGS_BOUNDS = {
  topResults: { min: 1, max: 200 },
  maxSeeds: { min: MIN_SEEDS, max: 100 },
  maxNegativeSeeds: { min: 1, max: 100 },
  negativeRelevanceLambda: { min: 0, max: 50 },
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(raw: unknown): TunableSettings {
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  return {
    topResults: clampInt(
      record.topResults,
      SETTINGS_BOUNDS.topResults.min,
      SETTINGS_BOUNDS.topResults.max,
      DEFAULT_SETTINGS.topResults,
    ),
    maxSeeds: clampInt(
      record.maxSeeds,
      SETTINGS_BOUNDS.maxSeeds.min,
      SETTINGS_BOUNDS.maxSeeds.max,
      DEFAULT_SETTINGS.maxSeeds,
    ),
    maxNegativeSeeds: clampInt(
      record.maxNegativeSeeds,
      SETTINGS_BOUNDS.maxNegativeSeeds.min,
      SETTINGS_BOUNDS.maxNegativeSeeds.max,
      DEFAULT_SETTINGS.maxNegativeSeeds,
    ),
    negativeRelevanceLambda: clampNumber(
      record.negativeRelevanceLambda,
      SETTINGS_BOUNDS.negativeRelevanceLambda.min,
      SETTINGS_BOUNDS.negativeRelevanceLambda.max,
      DEFAULT_SETTINGS.negativeRelevanceLambda,
    ),
  };
}

export async function loadSettings(): Promise<TunableSettings> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

export async function saveSettings(settings: TunableSettings): Promise<TunableSettings> {
  const normalized = normalizeSettings(settings);
  await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: normalized });
  return normalized;
}

export async function resetSettings(): Promise<TunableSettings> {
  return saveSettings(DEFAULT_SETTINGS);
}

export function settingsFromStorageChange(change: unknown): TunableSettings | null {
  if (!change || typeof change !== 'object') return null;
  const record = change as { newValue?: unknown };
  if (!('newValue' in record)) return null;
  return normalizeSettings(record.newValue);
}
