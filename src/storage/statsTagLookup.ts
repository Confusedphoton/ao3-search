import { isRedactedStatsTagName } from '../ao3/statsDump';
import type { StatsTagRecord } from '../graph/types';

const MAX_MERGER_CHAIN = 32;

export async function resolveCanonicalStatsTag(
  start: StatsTagRecord,
  lookup: (tagId: number) => Promise<StatsTagRecord | null>,
): Promise<StatsTagRecord> {
  let current = start;
  const seen = new Set<number>([start.tagId]);

  for (let depth = 0; depth < MAX_MERGER_CHAIN; depth += 1) {
    if (current.mergerId == null || isRedactedStatsTagName(current.name)) return current;
    if (seen.has(current.mergerId)) return current;

    const parent = await lookup(current.mergerId);
    if (!parent || isRedactedStatsTagName(parent.name)) return current;

    seen.add(parent.tagId);
    current = parent;
  }

  return current;
}
