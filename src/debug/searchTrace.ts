import type { CSRGraph } from '../graph/csr';
import type { GraphSnapshot } from '../graph/types';
import { NodeKind } from '../graph/types';
import type { NegativeSeed, PositiveSeed } from '../messaging/types';
import type { QueryPropagationResultPayload } from '../messaging/types';
import type { FrontierNode } from '../search/frontier';

export const SEARCH_TRACE_VERSION = 1;

export interface NodeTableEntry {
  index: number;
  id: number;
  kind: NodeKind;
  key: string;
  explored: boolean;
  title?: string;
}

export interface CsrSnapshot {
  offsets: number[];
  neighbors: number[];
  edgeWeights: number[];
  rowOutFractions: number[];
}

export interface PropagationSnapshot {
  priorLog: number[];
  tagPriorLog: number[];
  initialAuthority: number[];
  relevance: number[];
  authority: number[];
  precision: number[];
  expectedInfo: number[];
  iterations: { relevance: number; authority: number };
}

export interface FrontierSnapshot {
  nodeId: number;
  index: number;
  relevance: number;
  authority: number;
  precision: number;
  expectedInfo: number;
  rank: number;
}

export interface SearchTraceStep {
  stepIndex: number;
  phase: 'cold-start' | 'iterate' | 'final';
  requestsUsed: number;
  nodeTable: NodeTableEntry[];
  graph: GraphSnapshot;
  csr: CsrSnapshot;
  propagation?: PropagationSnapshot;
  frontier?: FrontierSnapshot[];
  action?: {
    picked: FrontierSnapshot;
    exploratory: boolean;
    expandedNode?: { nodeId: number; kind: string; key: string };
  };
}

export interface SearchTrace {
  version: typeof SEARCH_TRACE_VERSION;
  searchId: string;
  startedAt: string;
  seeds: { positive: PositiveSeed[]; negative: NegativeSeed[] };
  steps: SearchTraceStep[];
}

export interface SearchTraceInfo {
  available: boolean;
  searchId?: string;
  stepCount?: number;
  nodeCount?: number;
}

export function buildNodeTable(csr: CSRGraph): NodeTableEntry[] {
  return csr.nodeByIndex.map((node, index) => ({
    index,
    id: node.id,
    kind: node.kind,
    key: node.key,
    explored: node.explored,
    title: node.title,
  }));
}

export function snapshotCsr(csr: CSRGraph): CsrSnapshot {
  return {
    offsets: [...csr.offsets],
    neighbors: [...csr.neighbors],
    edgeWeights: [...csr.edgeWeights],
    rowOutFractions: [...csr.rowOutFractions],
  };
}

export function snapshotPropagation(
  result: QueryPropagationResultPayload,
): PropagationSnapshot {
  const debug = result.debug;
  const nodeCount = result.relevance.length;
  return {
    priorLog: debug?.priorLog ?? new Array(nodeCount).fill(0),
    tagPriorLog: debug?.tagPriorLog ?? new Array(nodeCount).fill(0),
    initialAuthority: debug?.initialAuthority ?? new Array(nodeCount).fill(0),
    relevance: [...result.relevance],
    authority: [...result.authority],
    precision: [...result.precision],
    expectedInfo: [...result.expectedInfo],
    iterations: { ...result.iterations },
  };
}

export function snapshotFrontier(
  frontier: FrontierNode[],
  picked?: FrontierNode | null,
  topN = 50,
): FrontierSnapshot[] {
  const snapshots: FrontierSnapshot[] = [];
  const included = new Set<number>();

  for (let rank = 0; rank < Math.min(topN, frontier.length); rank++) {
    const node = frontier[rank];
    snapshots.push({ ...node, rank });
    included.add(node.nodeId);
  }

  if (picked && !included.has(picked.nodeId)) {
    const rank = frontier.findIndex((n) => n.nodeId === picked.nodeId);
    snapshots.push({ ...picked, rank: rank >= 0 ? rank : -1 });
  }

  return snapshots;
}

export function nodeKindLabel(kind: NodeKind): string {
  switch (kind) {
    case NodeKind.Work:
      return 'work';
    case NodeKind.Tag:
      return 'tag';
    case NodeKind.Author:
      return 'author';
    default:
      return String(kind);
  }
}

export function logStepSummary(step: SearchTraceStep): void {
  const summary: Record<string, unknown> = {
    stepIndex: step.stepIndex,
    phase: step.phase,
    requestsUsed: step.requestsUsed,
    nodes: step.nodeTable.length,
    explored: step.nodeTable.filter((n) => n.explored).length,
  };
  if (step.propagation) {
    summary.maxExpectedInfo = Math.max(...step.propagation.expectedInfo, 0);
  }
  if (step.frontier) {
    summary.frontierSize = step.frontier.length;
    summary.topExpectedInfo = step.frontier[0]?.expectedInfo ?? 0;
  }
  if (step.action) {
    summary.picked = {
      kind: step.action.expandedNode?.kind ?? step.action.picked.nodeId,
      key: step.action.expandedNode?.key,
      expectedInfo: step.action.picked.expectedInfo,
      exploratory: step.action.exploratory,
    };
  }
  console.log('[ao3-search-trace]', summary);
}

export class SearchTraceRecorder {
  readonly trace: SearchTrace;

  private stepCounter = 0;

  constructor(seeds: { positive: PositiveSeed[]; negative: NegativeSeed[] }) {
    this.trace = {
      version: SEARCH_TRACE_VERSION,
      searchId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      seeds,
      steps: [],
    };
  }

  recordStep(step: Omit<SearchTraceStep, 'stepIndex'>): void {
    const fullStep: SearchTraceStep = { ...step, stepIndex: this.stepCounter++ };
    this.trace.steps.push(fullStep);
    logStepSummary(fullStep);
  }

  attachActionToLastStep(action: NonNullable<SearchTraceStep['action']>): void {
    const step = this.trace.steps[this.trace.steps.length - 1];
    if (step) {
      step.action = action;
      logStepSummary(step);
    }
  }

  finish(): SearchTrace {
    return this.trace;
  }
}

export function searchTraceInfo(trace: SearchTrace | null): SearchTraceInfo {
  if (!trace) return { available: false };
  const lastStep = trace.steps[trace.steps.length - 1];
  return {
    available: true,
    searchId: trace.searchId,
    stepCount: trace.steps.length,
    nodeCount: lastStep?.nodeTable.length ?? 0,
  };
}
