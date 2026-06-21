import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/src/config/constants';
import { NodeKind, type GraphExport } from '@/src/graph/types';
import {
  clearGraph,
  closeDbForTests,
  importGraphMerge,
  importGraphOverwrite,
  mergeWorkPage,
  resetDbForTests,
} from '@/src/storage/db';
import { exportGraph, getGraphStats, importGraph, parseGraphExport } from '@/src/storage/graphIo';

function sampleExport(overrides: Partial<GraphExport> = {}): GraphExport {
  return {
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    nextNodeId: 3,
    nodes: [
      {
        id: 0,
        kind: NodeKind.Work,
        key: '100',
        title: 'Alpha',
        estimatedFreq: 1,
        calibratedFreq: null,
        explored: true,
      },
      {
        id: 1,
        kind: NodeKind.Tag,
        key: 'fluff',
        estimatedFreq: 2,
        calibratedFreq: null,
        explored: false,
      },
      {
        id: 2,
        kind: NodeKind.Author,
        key: 'author-a',
        title: 'Author A',
        estimatedFreq: 1,
        calibratedFreq: 5,
        explored: true,
      },
    ],
    edges: [{ workNodeId: 0, tagNodeId: 1 }],
    authorEdges: [{ workNodeId: 0, authorNodeId: 2 }],
    ...overrides,
  };
}

async function deleteTestDb(): Promise<void> {
  await closeDbForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  resetDbForTests();
}

describe('graph import/export', () => {
  beforeEach(async () => {
    await deleteTestDb();
  });

  afterEach(async () => {
    await deleteTestDb();
  });

  it('parses valid exports and rejects invalid files', () => {
    expect(parseGraphExport(sampleExport())).not.toBeNull();
    expect(parseGraphExport({ ...sampleExport(), version: 2 })).toBeNull();
    expect(parseGraphExport({ ...sampleExport(), edges: [{ workNodeId: 0, tagNodeId: 99 }] })).toBeNull();
  });

  it('exports the current graph snapshot', async () => {
    await mergeWorkPage({
      workId: '42',
      title: 'Exported Work',
      tags: ['romance'],
      authors: [{ key: 'writer', displayName: 'Writer' }],
    });

    const exported = await exportGraph();
    expect(exported.version).toBe(1);
    expect(exported.nodes.some((node) => node.kind === NodeKind.Work && node.key === '42')).toBe(true);
    expect(exported.edges.length).toBeGreaterThan(0);
    expect(exported.authorEdges.length).toBeGreaterThan(0);
  });

  it('overwrites the stored graph', async () => {
    await mergeWorkPage({
      workId: '1',
      title: 'Old Work',
      tags: ['old-tag'],
      authors: [],
    });

    await importGraph(sampleExport(), 'overwrite');
    const stats = await getGraphStats();

    expect(stats.nodeCount).toBe(3);
    expect(stats.workCount).toBe(1);
    expect(stats.tagCount).toBe(1);
    expect(stats.authorCount).toBe(1);
    expect(stats.edgeCount).toBe(1);
    expect(stats.authorEdgeCount).toBe(1);
  });

  it('merges graphs by node key and keeps existing nodes', async () => {
    await mergeWorkPage({
      workId: '100',
      title: 'Existing Title',
      tags: ['fluff', 'local-only'],
      authors: [],
      explored: true,
    });

    await importGraph(sampleExport(), 'merge');
    const stats = await getGraphStats();

    expect(stats.workCount).toBe(1);
    expect(stats.tagCount).toBe(2);
    expect(stats.authorCount).toBe(1);
    expect(stats.edgeCount).toBe(2);
    expect(stats.authorEdgeCount).toBe(1);
  });

  it('imports overwrite data through db helpers', async () => {
    const data = sampleExport();
    await importGraphOverwrite(data);
    const stats = await getGraphStats();
    expect(stats.nodeCount).toBe(3);
  });

  it('imports merge data through db helpers without duplicating keyed nodes', async () => {
    await importGraphOverwrite(sampleExport());
    await importGraphMerge(sampleExport({ nextNodeId: 6 }));
    const stats = await getGraphStats();
    expect(stats.nodeCount).toBe(3);
  });

  it('clears graph before overwrite import', async () => {
    await mergeWorkPage({
      workId: '999',
      title: 'Gone',
      tags: ['gone'],
      authors: [],
    });
    await clearGraph();
    await importGraphOverwrite(sampleExport());
    const stats = await getGraphStats();
    expect(stats.workCount).toBe(1);
    expect(stats.workCount).not.toBe(2);
  });
});
