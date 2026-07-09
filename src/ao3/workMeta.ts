import type { CompletionStatus, WorkMetadata } from '../graph/types';

export function emptyWorkMetadata(): WorkMetadata {
  return {
    language: null,
    rating: null,
    archiveWarnings: [],
    completionStatus: null,
    fandoms: [],
    categories: [],
  };
}

export function completionStatusFromChapters(text: string | null | undefined): CompletionStatus | null {
  if (!text) return null;
  const match = text.trim().match(/^([\d,]+)\s*\/\s*([\d,?]+)/);
  if (!match) return null;
  const published = Number.parseInt(match[1].replace(/,/g, ''), 10);
  const totalRaw = match[2].trim();
  if (totalRaw === '?' || totalRaw === '') return 'Incomplete';
  const total = Number.parseInt(totalRaw.replace(/,/g, ''), 10);
  if (!Number.isFinite(published) || !Number.isFinite(total) || total <= 0) return null;
  return published >= total ? 'Complete' : 'Incomplete';
}

export function completionStatusFromLabel(text: string | null | undefined): CompletionStatus | null {
  if (!text) return null;
  const normalized = text.trim().toLowerCase();
  if (normalized === 'complete' || normalized === 'completed') return 'Complete';
  if (
    normalized === 'incomplete' ||
    normalized === 'work in progress' ||
    normalized === 'wip'
  ) {
    return 'Incomplete';
  }
  return null;
}

export function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function splitCommaSeparatedMeta(text: string | null | undefined): string[] {
  if (!text) return [];
  return uniqueNonEmpty(text.split(','));
}

export function mergeWorkMetadata(
  existing: WorkMetadata | undefined,
  incoming: WorkMetadata | undefined,
): WorkMetadata | undefined {
  if (!incoming && !existing) return undefined;
  if (!incoming) return existing;
  if (!existing) return incoming;

  return {
    language: incoming.language ?? existing.language,
    rating: incoming.rating ?? existing.rating,
    archiveWarnings:
      incoming.archiveWarnings.length > 0 ? incoming.archiveWarnings : existing.archiveWarnings,
    completionStatus: incoming.completionStatus ?? existing.completionStatus,
    fandoms: incoming.fandoms.length > 0 ? incoming.fandoms : existing.fandoms,
    categories: incoming.categories.length > 0 ? incoming.categories : existing.categories,
  };
}

export function normalizeWorkMetadata(raw: unknown): WorkMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;

  const language =
    typeof record.language === 'string' && record.language.trim()
      ? record.language.trim()
      : null;
  const rating =
    typeof record.rating === 'string' && record.rating.trim() ? record.rating.trim() : null;

  const archiveWarnings = Array.isArray(record.archiveWarnings)
    ? uniqueNonEmpty(record.archiveWarnings.filter((v): v is string => typeof v === 'string'))
    : [];
  const fandoms = Array.isArray(record.fandoms)
    ? uniqueNonEmpty(record.fandoms.filter((v): v is string => typeof v === 'string'))
    : [];
  const categories = Array.isArray(record.categories)
    ? uniqueNonEmpty(record.categories.filter((v): v is string => typeof v === 'string'))
    : [];

  let completionStatus: CompletionStatus | null = null;
  if (record.completionStatus === 'Complete' || record.completionStatus === 'Incomplete') {
    completionStatus = record.completionStatus;
  }

  return {
    language,
    rating,
    archiveWarnings,
    completionStatus,
    fandoms,
    categories,
  };
}
