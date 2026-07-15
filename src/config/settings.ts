import {
  MAX_NEGATIVE_SEEDS,
  MAX_SEEDS,
  MIN_SEEDS,
  NEGATIVE_RELEVANCE_LAMBDA,
  TOP_RESULTS,
} from './constants';
import {
  AO3_ARCHIVE_WARNINGS,
  AO3_CATEGORIES,
  AO3_COMPLETION_STATUSES,
  AO3_RATINGS,
  PERMEABILITY_CATEGORY_KEYS,
  type PermeabilityCategoryKey,
} from './ao3Meta';

export const SETTINGS_STORAGE_KEY = 'tunableSettings';

export type FilterMode = 'whitelist' | 'blacklist';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ExpansionPolicyKind = 'expected-info' | 'topological';

export interface CategoryPermeabilityFilter {
  mode: FilterMode;
  /** Applied to blocked values; allowed values always get 1. */
  permeability: number;
  values: string[];
}

export type PermeabilityFilters = Record<PermeabilityCategoryKey, CategoryPermeabilityFilter>;

export interface TunableSettings {
  topResults: number;
  maxSeeds: number;
  maxNegativeSeeds: number;
  negativeRelevanceLambda: number;
  theme: ThemePreference;
  expansionPolicy: ExpansionPolicyKind;
  permeability: PermeabilityFilters;
}

const DEFAULT_CATEGORY_FILTER: CategoryPermeabilityFilter = {
  mode: 'blacklist',
  permeability: 0,
  values: [],
};

function defaultPermeabilityFilters(): PermeabilityFilters {
  return {
    language: { ...DEFAULT_CATEGORY_FILTER, values: [] },
    rating: { ...DEFAULT_CATEGORY_FILTER, values: [] },
    archiveWarnings: { ...DEFAULT_CATEGORY_FILTER, values: [] },
    completionStatus: { ...DEFAULT_CATEGORY_FILTER, values: [] },
    fandoms: { ...DEFAULT_CATEGORY_FILTER, values: [] },
    categories: { ...DEFAULT_CATEGORY_FILTER, values: [] },
  };
}

export const DEFAULT_SETTINGS: TunableSettings = {
  topResults: TOP_RESULTS,
  maxSeeds: MAX_SEEDS,
  maxNegativeSeeds: MAX_NEGATIVE_SEEDS,
  negativeRelevanceLambda: NEGATIVE_RELEVANCE_LAMBDA,
  theme: 'system',
  expansionPolicy: 'topological',
  permeability: defaultPermeabilityFilters(),
};

/** Inclusive bounds used when normalizing stored or form values. */
export const SETTINGS_BOUNDS = {
  topResults: { min: 1, max: 200 },
  maxSeeds: { min: MIN_SEEDS, max: 100 },
  maxNegativeSeeds: { min: 1, max: 100 },
  negativeRelevanceLambda: { min: 0, max: 50 },
  permeability: { min: 0, max: 1 },
} as const;

const EXHAUSTIVE_VALUES: Partial<Record<PermeabilityCategoryKey, readonly string[]>> = {
  rating: AO3_RATINGS,
  archiveWarnings: AO3_ARCHIVE_WARNINGS,
  completionStatus: AO3_COMPLETION_STATUSES,
  categories: AO3_CATEGORIES,
};

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

function normalizeFilterMode(value: unknown): FilterMode {
  return value === 'whitelist' ? 'whitelist' : 'blacklist';
}

function normalizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function normalizeExpansionPolicy(value: unknown): ExpansionPolicyKind {
  return value === 'expected-info' ? 'expected-info' : 'topological';
}

function normalizeFilterValues(
  category: PermeabilityCategoryKey,
  raw: unknown,
): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = EXHAUSTIVE_VALUES[category];
  const allowedSet = allowed ? new Set<string>(allowed) : null;
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (allowedSet && !allowedSet.has(trimmed)) continue;
    seen.add(trimmed);
    values.push(trimmed);
  }
  // Completion is a binary exclusive choice in the UI.
  if (category === 'completionStatus' && values.length > 1) {
    return [values[0]!];
  }
  return values;
}

function normalizeCategoryFilter(
  category: PermeabilityCategoryKey,
  raw: unknown,
): CategoryPermeabilityFilter {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    mode: normalizeFilterMode(record.mode),
    permeability: clampNumber(
      record.permeability,
      SETTINGS_BOUNDS.permeability.min,
      SETTINGS_BOUNDS.permeability.max,
      DEFAULT_CATEGORY_FILTER.permeability,
    ),
    values: normalizeFilterValues(category, record.values),
  };
}

function normalizePermeabilityFilters(raw: unknown): PermeabilityFilters {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const filters = defaultPermeabilityFilters();
  for (const key of PERMEABILITY_CATEGORY_KEYS) {
    filters[key] = normalizeCategoryFilter(key, record[key]);
  }
  return filters;
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
    theme: normalizeTheme(record.theme),
    expansionPolicy: normalizeExpansionPolicy(record.expansionPolicy),
    permeability: normalizePermeabilityFilters(record.permeability),
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
