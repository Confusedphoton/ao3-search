import type { PageData } from '../ao3/types';
import type { GraphExport, GraphImportMode, GraphStats, StatsImportProgress } from '../graph/types';

export type PositiveSeed =
  | { kind: 'work'; workId: string; title: string; url: string }
  | { kind: 'tag'; tagName: string; url: string }
  | { kind: 'author'; authorKey: string; displayName: string; url: string };

/** @deprecated Use PositiveSeed */
export type SeedWork = Extract<PositiveSeed, { kind: 'work' }>;

export type NegativeSeed =
  | { kind: 'work'; workId: string; title: string; url: string }
  | { kind: 'tag'; tagName: string; url: string }
  | { kind: 'author'; authorKey: string; displayName: string; url: string };

export interface SearchProgressPayload {
  phase: 'cold-start' | 'expanding' | 'ranking' | 'done' | 'error';
  requestsUsed: number;
  expansionBudget: number;
  frontierSize: number;
  message?: string;
  previewResults?: SearchResultItem[];
}

export interface SearchResultItem {
  workId: string;
  title: string;
  url: string;
  authority: number;
}

export interface SearchResultsPayload {
  results: SearchResultItem[];
  requestsUsed: number;
}

export interface PropagationInputPayload {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions?: number[];
  seedIndices: number[];
  negativeSeedIndices?: number[];
  negativeWeight?: number;
  signalIds: string[];
  alpha: number;
  maxIterations: number;
  tolerance: number;
}

export interface PropagationResultPayload {
  signals: Record<string, number[]>;
  iterations: number;
  deltas: Record<string, number>;
}

/** @deprecated Use PropagationInputPayload with signalIds: ['rank'] */
export interface PPRInputPayload {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions?: number[];
  seedIndices: number[];
  negativeSeedIndices?: number[];
  negativeWeight?: number;
  alpha: number;
  maxIterations: number;
  tolerance: number;
}

/** @deprecated Use PropagationResultPayload */
export interface PPRResultPayload {
  authority: number[];
  iterations: number;
  delta: number;
}

export interface GraphTagMatch {
  tagName: string;
  workCount: number | null;
}

export type ExtensionMessage =
  | { type: 'PageDataIngested'; payload: PageData }
  | { type: 'AddSeedFromTab' }
  | { type: 'AddSeedTag'; tagName: string }
  | { type: 'RemoveSeed'; kind: 'work' | 'tag' | 'author'; key: string }
  | { type: 'AddNegativeWorkFromTab' }
  | { type: 'AddNegativeTagFromTab' }
  | { type: 'AddNegativeTag'; tagName: string }
  | { type: 'RemoveNegativeSeed'; kind: 'work' | 'tag' | 'author'; key: string }
  | { type: 'SearchGraphTags'; query: string }
  | { type: 'GraphTagResults'; tags: GraphTagMatch[] }
  | { type: 'GetState' }
  | {
      type: 'StateUpdate';
      seeds: PositiveSeed[];
      negativeSeeds: NegativeSeed[];
      searching: boolean;
      progress: SearchProgressPayload | null;
      results: SearchResultItem[];
    }
  | { type: 'StartSearch' }
  | { type: 'CancelSearch' }
  | { type: 'ExportGraph' }
  | { type: 'GraphExported'; export: GraphExport }
  | { type: 'ImportGraph'; export: GraphExport; mode: GraphImportMode }
  | {
      type: 'GraphImportResult';
      success: boolean;
      message: string;
      stats: GraphStats | null;
    }
  | { type: 'GetGraphStats' }
  | { type: 'GraphStats'; stats: GraphStats }
  | { type: 'StatsImportProgress'; payload: StatsImportProgress }
  | { type: 'SearchProgress'; payload: SearchProgressPayload }
  | { type: 'SearchResults'; payload: SearchResultsPayload };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as { type?: unknown };
  return typeof msg.type === 'string';
}
