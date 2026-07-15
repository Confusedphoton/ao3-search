import { EXPLORATION_STALE_MS } from '../config/constants';
import { NodeKind, type ExplorationStatus, type GraphNode } from './types';

export function isFullyExplored(node: Pick<GraphNode, 'explorationStatus'>): boolean {
  return node.explorationStatus === 'complete';
}

/** Frontier / expand eligibility ignoring staleness. */
export function isIncomplete(node: Pick<GraphNode, 'explorationStatus'>): boolean {
  return node.explorationStatus !== 'complete';
}

export function isExplorationStale(
  node: Pick<GraphNode, 'exploredAt'>,
  now = Date.now(),
  staleMs = EXPLORATION_STALE_MS,
): boolean {
  if (node.exploredAt == null) return true;
  return now - node.exploredAt >= staleMs;
}

/**
 * Nodes the default policy may expand: incomplete hubs/works, or complete
 * tag/author hubs whose exploration is stale (freshness recheck).
 */
export function isExpandable(
  node: Pick<GraphNode, 'kind' | 'explorationStatus' | 'exploredAt'>,
  now = Date.now(),
  staleMs = EXPLORATION_STALE_MS,
): boolean {
  if (node.explorationStatus !== 'complete') return true;
  // Works stay complete until explicitly re-fetched; only listing hubs recheck.
  if (node.kind === NodeKind.Work) return false;
  return isExplorationStale(node, now, staleMs);
}

/** Legacy boolean mirror: complete === explored. */
export function exploredFlag(node: Pick<GraphNode, 'explorationStatus'>): boolean {
  return isFullyExplored(node);
}

export function defaultExplorationFields(
  status: ExplorationStatus = 'unexplored',
): Pick<
  GraphNode,
  'explorationStatus' | 'exploredAt' | 'listingNextPage' | 'listingPagesFetched' | 'explored'
> {
  return {
    explorationStatus: status,
    exploredAt: null,
    listingNextPage: null,
    listingPagesFetched: 0,
    explored: status === 'complete',
  };
}

export interface ListingExplorationInput {
  previousStatus: ExplorationStatus;
  previousCalibratedFreq: number | null;
  previousPagesFetched: number;
  workCount: number | null;
  /** Parsed next page number, or null if exhausted / unknown. */
  nextPage: number | null;
  /** 1-based page that was just fetched. */
  pageFetched: number;
  now?: number;
}

export interface ListingExplorationResult {
  explorationStatus: ExplorationStatus;
  exploredAt: number;
  listingNextPage: number | null;
  listingPagesFetched: number;
  calibratedFreq: number | null;
  demoted: boolean;
}

/**
 * Derive listing-hub exploration state after a tag/author/search fetch.
 * Demotes complete → partial when AO3 workCount grew past the stored calibratedFreq.
 */
export function resolveListingExploration(input: ListingExplorationInput): ListingExplorationResult {
  const now = input.now ?? Date.now();
  const pagesFetched = Math.max(input.previousPagesFetched, input.pageFetched);
  const previousCount = input.previousCalibratedFreq;
  const workCount = input.workCount;

  const calibratedFreq =
    workCount == null
      ? previousCount
      : previousCount == null
        ? workCount
        : Math.max(previousCount, workCount);

  const grew =
    workCount != null && previousCount != null && workCount > previousCount;

  if (grew) {
    return {
      explorationStatus: 'partial',
      exploredAt: now,
      listingNextPage: 1,
      listingPagesFetched: pagesFetched,
      calibratedFreq,
      demoted: input.previousStatus === 'complete',
    };
  }

  if (input.nextPage != null) {
    return {
      explorationStatus: 'partial',
      exploredAt: now,
      listingNextPage: input.nextPage,
      listingPagesFetched: pagesFetched,
      calibratedFreq,
      demoted: false,
    };
  }

  return {
    explorationStatus: 'complete',
    exploredAt: now,
    listingNextPage: null,
    listingPagesFetched: pagesFetched,
    calibratedFreq,
    demoted: false,
  };
}

export function normalizeExplorationFields(
  node: Partial<GraphNode> & Pick<GraphNode, 'id' | 'kind' | 'key' | 'estimatedFreq'>,
): GraphNode {
  const exploredLegacy = node.explored === true;
  const explorationStatus =
    node.explorationStatus ?? (exploredLegacy ? 'complete' : 'unexplored');
  return {
    id: node.id,
    kind: node.kind,
    key: node.key,
    title: node.title,
    wordCount: node.wordCount ?? null,
    estimatedFreq: node.estimatedFreq,
    calibratedFreq: node.calibratedFreq ?? null,
    explorationStatus,
    exploredAt: node.exploredAt ?? (explorationStatus === 'complete' ? 1 : null),
    listingNextPage:
      node.listingNextPage !== undefined
        ? node.listingNextPage
        : explorationStatus === 'partial'
          ? 1
          : null,
    listingPagesFetched:
      node.listingPagesFetched ?? (explorationStatus === 'unexplored' ? 0 : 1),
    explored: explorationStatus === 'complete',
    ...(node.meta ? { meta: node.meta } : {}),
  };
}

export function mergeExplorationStatus(
  a: ExplorationStatus,
  b: ExplorationStatus,
): ExplorationStatus {
  const rank = { unexplored: 0, partial: 1, complete: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}
