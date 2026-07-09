import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/src/config/constants';
import { NodeKind } from '@/src/graph/types';
import {
  closeDbForTests,
  getWorkNode,
  mergeWorkPage,
  resetDbForTests,
} from '@/src/storage/db';

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

describe('work metadata persistence', () => {
  beforeEach(async () => {
    await deleteTestDb();
  });

  afterEach(async () => {
    await deleteTestDb();
  });

  it('stores and merges work metadata on upsert', async () => {
    await mergeWorkPage({
      workId: '42',
      title: 'Meta Work',
      tags: ['Fluff'],
      authors: [],
      meta: {
        language: 'English',
        rating: 'Teen And Up Audiences',
        archiveWarnings: ['No Archive Warnings Apply'],
        completionStatus: 'Incomplete',
        fandoms: ['Harry Potter'],
        categories: ['M/M'],
      },
    });

    const first = await getWorkNode('42');
    expect(first?.kind).toBe(NodeKind.Work);
    expect(first?.meta).toEqual({
      language: 'English',
      rating: 'Teen And Up Audiences',
      archiveWarnings: ['No Archive Warnings Apply'],
      completionStatus: 'Incomplete',
      fandoms: ['Harry Potter'],
      categories: ['M/M'],
    });

    await mergeWorkPage({
      workId: '42',
      title: 'Meta Work',
      tags: ['Fluff'],
      authors: [],
      meta: {
        language: null,
        rating: 'Explicit',
        archiveWarnings: [],
        completionStatus: 'Complete',
        fandoms: [],
        categories: ['M/M', 'Gen'],
      },
    });

    const merged = await getWorkNode('42');
    expect(merged?.meta).toEqual({
      language: 'English',
      rating: 'Explicit',
      archiveWarnings: ['No Archive Warnings Apply'],
      completionStatus: 'Complete',
      fandoms: ['Harry Potter'],
      categories: ['M/M', 'Gen'],
    });
  });
});
