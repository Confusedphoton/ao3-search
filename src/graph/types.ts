export enum NodeKind {
  Work = 0,
  Tag = 1,
  Author = 2,
}

export type CompletionStatus = 'Complete' | 'Incomplete';

/** Typed AO3 work metadata used for permeability filtration (not graph tag edges). */
export interface WorkMetadata {
  language: string | null;
  rating: string | null;
  archiveWarnings: string[];
  completionStatus: CompletionStatus | null;
  fandoms: string[];
  categories: string[];
}

export type ExplorationStatus = 'unexplored' | 'partial' | 'complete';

export interface GraphNode {
  id: number;
  kind: NodeKind;
  key: string;
  title?: string;
  wordCount: number | null;
  estimatedFreq: number;
  calibratedFreq: number | null;
  explorationStatus: ExplorationStatus;
  /** Last successful exploration fetch (ms epoch); null if never explored. */
  exploredAt: number | null;
  /** Next listing/search page to fetch; null when unknown or exhausted. */
  listingNextPage: number | null;
  listingPagesFetched: number;
  /**
   * Legacy mirror of `explorationStatus === 'complete'`.
   * Prefer `explorationStatus` / helpers in `exploration.ts`.
   */
  explored: boolean;
  /** Present on work nodes when scraped; omitted for tags/authors. */
  meta?: WorkMetadata;
}

export interface GraphEdge {
  workNodeId: number;
  tagNodeId: number;
}

export interface AuthorWorkEdge {
  workNodeId: number;
  authorNodeId: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  authorEdges: AuthorWorkEdge[];
}

export interface GraphExport {
  version: number;
  exportedAt: string;
  nextNodeId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  authorEdges: AuthorWorkEdge[];
}

export type GraphImportMode = 'merge' | 'overwrite';

export interface GraphStats {
  nodeCount: number;
  workCount: number;
  tagCount: number;
  authorCount: number;
  edgeCount: number;
  authorEdgeCount: number;
}

export interface StatsTagRecord {
  tagId: number;
  name: string;
  type: string;
  canonical: boolean;
  cachedCount: number;
  mergerId: number | null;
}

export interface StatsImportProgress {
  phase: 'tags' | 'works' | 'done' | 'error';
  rowsProcessed: number;
  tagsStored: number;
  tagsCalibrated: number;
  tagsMerged: number;
  worksMatched: number;
  edgesAdded: number;
  message?: string;
}

export interface StatsImportResult {
  tagsStored: number;
  tagsCalibrated: number;
  tagsMerged: number;
  worksMatched: number;
  edgesAdded: number;
}

export interface WorkAuthorInput {
  key: string;
  displayName: string;
}

export interface WorkMergeInput {
  workId: string;
  title: string;
  tags: string[];
  authors: WorkAuthorInput[];
  wordCount?: number | null;
  /** When true/omitted for a full work page, marks complete. */
  explored?: boolean;
  explorationStatus?: ExplorationStatus;
  exploredAt?: number | null;
  meta?: WorkMetadata;
}

export interface ListedWorkInput {
  workId: string;
  title: string;
  tags?: string[];
  authors?: WorkAuthorInput[];
  wordCount?: number | null;
  meta?: WorkMetadata;
}

export interface SearchMergeInput {
  works: ListedWorkInput[];
  /** Optional hub to update exploration status from this search page. */
  marksNodeId?: number;
  workCount?: number | null;
  page?: number;
  nextPage?: number | null;
}

export interface TagMergeInput {
  tagName: string;
  workCount: number | null;
  works: ListedWorkInput[];
  explored?: boolean;
  explorationStatus?: ExplorationStatus;
  exploredAt?: number | null;
  page?: number;
  nextPage?: number | null;
}

export interface AuthorMergeInput {
  authorKey: string;
  displayName: string;
  workCount: number | null;
  works: ListedWorkInput[];
  explored?: boolean;
  explorationStatus?: ExplorationStatus;
  exploredAt?: number | null;
  page?: number;
  nextPage?: number | null;
}

export interface ExplorationUpdateInput {
  nodeId: number;
  explorationStatus: ExplorationStatus;
  exploredAt: number;
  listingNextPage: number | null;
  listingPagesFetched: number;
  calibratedFreq?: number | null;
}
