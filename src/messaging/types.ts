import type { PageData } from '../ao3/types';

export interface SeedWork {
  workId: string;
  title: string;
  url: string;
}

export interface SearchProgressPayload {
  phase: 'cold-start' | 'expanding' | 'ranking' | 'done' | 'error';
  requestsUsed: number;
  expansionBudget: number;
  frontierSize: number;
  message?: string;
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

export interface PPRInputPayload {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  seedIndices: number[];
  alpha: number;
  maxIterations: number;
  tolerance: number;
}

export interface PPRResultPayload {
  authority: number[];
  iterations: number;
  delta: number;
}

export type ExtensionMessage =
  | { type: 'PageDataIngested'; payload: PageData }
  | { type: 'AddSeedFromTab' }
  | { type: 'RemoveSeed'; workId: string }
  | { type: 'GetState' }
  | { type: 'StateUpdate'; seeds: SeedWork[]; searching: boolean; progress: SearchProgressPayload | null }
  | { type: 'StartSearch' }
  | { type: 'CancelSearch' }
  | { type: 'SearchProgress'; payload: SearchProgressPayload }
  | { type: 'SearchResults'; payload: SearchResultsPayload };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as { type?: unknown };
  return typeof msg.type === 'string';
}
