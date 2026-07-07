import type { PageData } from '../ao3/types';
import type { SearchTrace, SearchTraceInfo } from '../debug/searchTrace';
import type { GraphExport, GraphImportMode, GraphStats, StatsImportProgress } from '../graph/types';

export type PositiveSeed =
  | { kind: 'work'; workId: string; title: string; url: string }
  | { kind: 'tag'; tagName: string; url: string }
  | { kind: 'author'; authorKey: string; displayName: string; url: string };

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
  relevance: number;
}

export interface SearchResultsPayload {
  results: SearchResultItem[];
  requestsUsed: number;
  expansionBudget: number;
  frontierSize: number;
}

export interface QueryPropagationInputPayload {
  mode: 'query';
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions?: number[];
  seedIndices: number[];
  negativeSeedIndices?: number[];
  negativeWeight?: number;
  workIndices: number[];
  tagIndices: number[];
  authorIndices: number[];
  authorWorkIndexEdges: Array<{ workIndex: number; authorIndex: number }>;
  wordCounts: Array<number | null>;
  nodeKinds: number[];
  alpha: number;
  maxIterations: number;
  tolerance: number;
  debug?: boolean;
}

export interface QueryPropagationDebugPayload {
  priorLog: number[];
  tagPriorLog: number[];
  initialAuthority: number[];
}

export interface QueryPropagationResultPayload {
  relevance: number[];
  authority: number[];
  precision: number[];
  expectedInfo: number[];
  iterations: { relevance: number; authority: number };
  debug?: QueryPropagationDebugPayload;
}

export interface PropagationInputPayload {
  mode?: 'signals';
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
  | { type: 'ContinueSearch' }
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
  | { type: 'SearchResults'; payload: SearchResultsPayload }
  | { type: 'ExportSearchTrace' }
  | { type: 'SearchTraceExported'; trace: SearchTrace | null }
  | { type: 'GetSearchTrace' }
  | { type: 'SearchTraceInfo'; info: SearchTraceInfo };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as { type?: unknown };
  return typeof msg.type === 'string';
}
