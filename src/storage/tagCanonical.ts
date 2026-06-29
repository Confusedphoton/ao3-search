import { isRedactedStatsTagName } from '../ao3/statsDump';
import type { StatsTagRecord } from '../graph/types';
import { NodeKind } from '../graph/types';
import {
  canonicalizeGraphTagNode,
  getAllGraphTagNodes,
  getNodeByKey,
  getStatsTag,
  getStatsTagByName,
} from './db';
import { resolveCanonicalStatsTag } from './statsTagLookup';

export async function resolveGraphTagName(tagName: string): Promise<string> {
  const trimmed = tagName.trim();
  if (!trimmed) return tagName;

  const statsTag = await getStatsTagByName(trimmed);
  if (!statsTag) return trimmed;

  const canonical = await resolveCanonicalStatsTag(statsTag, getStatsTag);
  if (!canonical.name || isRedactedStatsTagName(canonical.name)) return trimmed;
  return canonical.name;
}

export async function applyStatsTagMergesToGraph(): Promise<number> {
  const tagNodes = await getAllGraphTagNodes();
  let merged = 0;

  for (const node of tagNodes) {
    const current = await getNodeByKey(NodeKind.Tag, node.key);
    if (!current || current.id !== node.id) continue;

    const statsTag = await getStatsTagByName(node.key);
    if (!statsTag) continue;

    const canonical = await resolveCanonicalStatsTag(statsTag, getStatsTag);
    if (!canonical.name || canonical.name === node.key || isRedactedStatsTagName(canonical.name)) {
      continue;
    }

    await canonicalizeGraphTagNode(node.id, canonical.name, canonical.cachedCount);
    merged += 1;
  }

  return merged;
}

export async function resolveStatsTagForGraph(tag: StatsTagRecord): Promise<StatsTagRecord> {
  return resolveCanonicalStatsTag(tag, getStatsTag);
}

export { resolveCanonicalStatsTag } from './statsTagLookup';
