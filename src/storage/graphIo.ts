import { GRAPH_EXPORT_VERSION } from '../config/constants';
import { normalizeWorkMetadata } from '../ao3/workMeta';
import type {
  AuthorWorkEdge,
  GraphEdge,
  GraphExport,
  GraphImportMode,
  GraphNode,
  GraphStats,
} from '../graph/types';
import { NodeKind } from '../graph/types';
import {
  getNextNodeId,
  importGraphMerge,
  importGraphOverwrite,
  loadGraphSnapshot,
} from './db';

function isNodeKind(value: unknown): value is NodeKind {
  return value === NodeKind.Work || value === NodeKind.Tag || value === NodeKind.Author;
}

function parseGraphNode(value: unknown): GraphNode | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'number' || !Number.isInteger(record.id) || record.id < 0) return null;
  if (!isNodeKind(record.kind)) return null;
  if (typeof record.key !== 'string' || !record.key) return null;
  if (typeof record.estimatedFreq !== 'number' || record.estimatedFreq < 0) return null;
  if (record.calibratedFreq != null && typeof record.calibratedFreq !== 'number') return null;
  if (typeof record.explored !== 'boolean') return null;
  if (record.title != null && typeof record.title !== 'string') return null;
  if (record.wordCount != null && typeof record.wordCount !== 'number') return null;

  const meta =
    record.kind === NodeKind.Work ? normalizeWorkMetadata(record.meta) : undefined;

  return {
    id: record.id,
    kind: record.kind,
    key: record.key,
    title: typeof record.title === 'string' ? record.title : undefined,
    wordCount: typeof record.wordCount === 'number' ? record.wordCount : null,
    estimatedFreq: record.estimatedFreq,
    calibratedFreq: record.calibratedFreq ?? null,
    explored: record.explored,
    ...(meta ? { meta } : {}),
  };
}

function parseGraphEdge(value: unknown): GraphEdge | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.workNodeId !== 'number' || !Number.isInteger(record.workNodeId)) return null;
  if (typeof record.tagNodeId !== 'number' || !Number.isInteger(record.tagNodeId)) return null;
  return { workNodeId: record.workNodeId, tagNodeId: record.tagNodeId };
}

function parseAuthorWorkEdge(value: unknown): AuthorWorkEdge | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.workNodeId !== 'number' || !Number.isInteger(record.workNodeId)) return null;
  if (typeof record.authorNodeId !== 'number' || !Number.isInteger(record.authorNodeId)) return null;
  return { workNodeId: record.workNodeId, authorNodeId: record.authorNodeId };
}

export function parseGraphExport(value: unknown): GraphExport | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== GRAPH_EXPORT_VERSION) return null;
  if (typeof record.exportedAt !== 'string' || !record.exportedAt) return null;
  if (typeof record.nextNodeId !== 'number' || !Number.isInteger(record.nextNodeId) || record.nextNodeId < 0) {
    return null;
  }
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges) || !Array.isArray(record.authorEdges)) {
    return null;
  }

  const nodes: GraphNode[] = [];
  for (const node of record.nodes) {
    const parsed = parseGraphNode(node);
    if (!parsed) return null;
    nodes.push(parsed);
  }

  const edges: GraphEdge[] = [];
  for (const edge of record.edges) {
    const parsed = parseGraphEdge(edge);
    if (!parsed) return null;
    edges.push(parsed);
  }

  const authorEdges: AuthorWorkEdge[] = [];
  for (const edge of record.authorEdges) {
    const parsed = parseAuthorWorkEdge(edge);
    if (!parsed) return null;
    authorEdges.push(parsed);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) return null;

  for (const edge of edges) {
    if (!nodeIds.has(edge.workNodeId) || !nodeIds.has(edge.tagNodeId)) return null;
  }
  for (const edge of authorEdges) {
    if (!nodeIds.has(edge.workNodeId) || !nodeIds.has(edge.authorNodeId)) return null;
  }

  const maxNodeId = nodes.reduce((max, node) => Math.max(max, node.id), -1);
  if (record.nextNodeId <= maxNodeId) return null;

  return {
    version: GRAPH_EXPORT_VERSION,
    exportedAt: record.exportedAt,
    nextNodeId: record.nextNodeId,
    nodes,
    edges,
    authorEdges,
  };
}

export function graphStatsFromSnapshot(snapshot: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  authorEdges: AuthorWorkEdge[];
}): GraphStats {
  let workCount = 0;
  let tagCount = 0;
  let authorCount = 0;
  for (const node of snapshot.nodes) {
    if (node.kind === NodeKind.Work) workCount += 1;
    else if (node.kind === NodeKind.Tag) tagCount += 1;
    else authorCount += 1;
  }

  return {
    nodeCount: snapshot.nodes.length,
    workCount,
    tagCount,
    authorCount,
    edgeCount: snapshot.edges.length,
    authorEdgeCount: snapshot.authorEdges.length,
  };
}

export async function exportGraph(): Promise<GraphExport> {
  const snapshot = await loadGraphSnapshot();
  const nextNodeId = await getNextNodeId();

  return {
    version: GRAPH_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    nextNodeId,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    authorEdges: snapshot.authorEdges,
  };
}

export async function getGraphStats(): Promise<GraphStats> {
  const snapshot = await loadGraphSnapshot();
  return graphStatsFromSnapshot(snapshot);
}

export async function importGraph(data: GraphExport, mode: GraphImportMode): Promise<GraphStats> {
  if (mode === 'overwrite') {
    await importGraphOverwrite(data);
  } else {
    await importGraphMerge(data);
  }
  return getGraphStats();
}
