import type { Ao3WorkSearchParams } from '../ao3/workSearch';
import type { ExplorationStatus } from '../graph/types';

export type FetchPlan =
  | { type: 'work'; workId: string; marksNodeId: number }
  | { type: 'tagListing'; tagName: string; page: number; marksNodeId: number }
  | { type: 'authorListing'; authorKey: string; page: number; marksNodeId: number }
  | { type: 'worksSearch'; params: Ao3WorkSearchParams; marksNodeId?: number };

export interface FetchOutcome {
  requestCount: 1;
  marksNodeId?: number;
  explorationStatus: ExplorationStatus;
  listingNextPage: number | null;
  listingPagesFetched: number;
  workCount: number | null;
}
