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

export interface GraphNode {
  id: number;
  kind: NodeKind;
  key: string;
  title?: string;
  wordCount: number | null;
  estimatedFreq: number;
  calibratedFreq: number | null;
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
  explored?: boolean;
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
}

export interface TagMergeInput {
  tagName: string;
  workCount: number | null;
  works: ListedWorkInput[];
  explored?: boolean;
}

export interface AuthorMergeInput {
  authorKey: string;
  displayName: string;
  workCount: number | null;
  works: ListedWorkInput[];
  explored?: boolean;
}
