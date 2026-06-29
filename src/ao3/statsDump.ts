import { STATS_SYSTEM_TAG_TYPES } from '../config/constants';

export const REDACTED_STATS_TAG_NAME = 'Redacted';

export function isRedactedStatsTagName(name: string): boolean {
  return name.trim() === REDACTED_STATS_TAG_NAME;
}

export interface StatsTagRow {
  tagId: number;
  type: string;
  name: string;
  canonical: boolean;
  cachedCount: number;
  mergerId: number | null;
}

export function isContentStatsTagType(type: string): boolean {
  return !STATS_SYSTEM_TAG_TYPES.has(type);
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  fields.push(current);
  return fields;
}

function parseBooleanField(value: string): boolean {
  return value.trim().toLowerCase() === 'true';
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStatsTagRow(line: string): StatsTagRow | null {
  if (!line.trim()) return null;
  const fields = parseCsvLine(line);
  if (fields.length < 5) return null;

  const tagId = Number.parseInt(fields[0], 10);
  const cachedCount = Number.parseInt(fields[4], 10);
  if (!Number.isFinite(tagId) || tagId < 0) return null;
  if (!Number.isFinite(cachedCount) || cachedCount < 0) return null;

  const mergerId = fields.length >= 6 ? parseOptionalInt(fields[5]) : null;
  const name = fields[2];
  if (isRedactedStatsTagName(name)) return null;

  return {
    tagId,
    type: fields[1].trim(),
    name,
    canonical: parseBooleanField(fields[3]),
    cachedCount,
    mergerId,
  };
}

export function isStatsTagsFileName(fileName: string): boolean {
  return /tags-\d{8}\.csv$/i.test(fileName);
}
