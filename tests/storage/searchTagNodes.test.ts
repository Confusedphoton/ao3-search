import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/src/config/constants';
import { NodeKind } from '@/src/graph/types';
import {
  closeDbForTests,
  mergeTagPage,
  mergeWorkPage,
  resetDbForTests,
  searchTagNodes,
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

describe('searchTagNodes', () => {
  beforeEach(async () => {
    await deleteTestDb();
    await mergeWorkPage({
      workId: '1',
      title: 'Test work',
      tags: ['Fluff', 'Angst', 'Harry Potter - J. K. Rowling'],
      authors: [],
      explored: true,
    });
    await mergeTagPage({
      tagName: 'Slow Burn',
      workCount: 500,
      works: [],
      explored: true,
    });
  });

  afterEach(async () => {
    await deleteTestDb();
  });

  it('ranks fuzzy matches ahead of weak matches', async () => {
    const results = await searchTagNodes('fluf', 5);
    expect(results[0]?.key).toBe('Fluff');
  });

  it('finds tags from subsequence queries', async () => {
    const results = await searchTagNodes('slbrn', 5);
    expect(results.some((node) => node.key === 'Slow Burn')).toBe(true);
  });

  it('returns results sorted by popularity after match quality', async () => {
    const results = await searchTagNodes('a', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((node) => node.kind === NodeKind.Tag)).toBe(true);
  });
});
