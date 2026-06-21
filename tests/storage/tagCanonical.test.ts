import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/src/config/constants';
import { NodeKind } from '@/src/graph/types';
import {
  closeDbForTests,
  getTagNode,
  loadGraphSnapshot,
  mergeWorkPage,
  putStatsTagsBatch,
  resetDbForTests,
} from '@/src/storage/db';
import { applyStatsTagMergesToGraph, resolveGraphTagName } from '@/src/storage/tagCanonical';
import { resolveCanonicalStatsTag } from '@/src/storage/statsTagLookup';

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

describe('tag canonicalization', () => {
  beforeEach(async () => {
    await deleteTestDb();
  });

  afterEach(async () => {
    await deleteTestDb();
  });

  it('follows merger_id chains in stats metadata', async () => {
    const lookup = async (tagId: number) => {
      const records = {
        183: {
          tagId: 183,
          name: 'Harry Potter - Rowling',
          type: 'Fandom',
          canonical: false,
          cachedCount: 6220,
          mergerId: 136512,
        },
        136512: {
          tagId: 136512,
          name: 'Harry Potter - J. K. Rowling',
          type: 'Fandom',
          canonical: true,
          cachedCount: 361919,
          mergerId: null,
        },
      };
      return records[tagId as keyof typeof records] ?? null;
    };

    const canonical = await resolveCanonicalStatsTag(
      {
        tagId: 183,
        name: 'Harry Potter - Rowling',
        type: 'Fandom',
        canonical: false,
        cachedCount: 6220,
        mergerId: 136512,
      },
      lookup,
    );

    expect(canonical.tagId).toBe(136512);
    expect(canonical.name).toBe('Harry Potter - J. K. Rowling');
  });

  it('merges synonym tag nodes into the canonical graph node', async () => {
    await mergeWorkPage({
      workId: '10',
      title: 'Synonym work',
      tags: ['Harry Potter - Rowling'],
      authors: [],
    });
    await mergeWorkPage({
      workId: '20',
      title: 'Canonical work',
      tags: ['Harry Potter - J. K. Rowling'],
      authors: [],
    });

    await putStatsTagsBatch([
      {
        tagId: 183,
        name: 'Harry Potter - Rowling',
        type: 'Fandom',
        canonical: false,
        cachedCount: 6220,
        mergerId: 136512,
      },
      {
        tagId: 136512,
        name: 'Harry Potter - J. K. Rowling',
        type: 'Fandom',
        canonical: true,
        cachedCount: 361919,
        mergerId: null,
      },
    ]);

    await mergeWorkPage({
      workId: '10',
      title: 'Synonym work',
      tags: ['Harry Potter - Rowling'],
      authors: [],
    });
    await mergeWorkPage({
      workId: '20',
      title: 'Canonical work',
      tags: ['Harry Potter - J. K. Rowling'],
      authors: [],
    });

    const merged = await applyStatsTagMergesToGraph();
    expect(merged).toBe(1);

    const snapshot = await loadGraphSnapshot();
    const tagNodes = snapshot.nodes.filter((node) => node.kind === NodeKind.Tag);
    expect(tagNodes).toHaveLength(1);
    expect(tagNodes[0]?.key).toBe('Harry Potter - J. K. Rowling');
    expect(snapshot.edges).toHaveLength(2);
    expect(snapshot.edges.every((edge) => edge.tagNodeId === tagNodes[0]?.id)).toBe(true);
  });

  it('renames a lone synonym tag node to the canonical name', async () => {
    await mergeWorkPage({
      workId: '10',
      title: 'Synonym work',
      tags: ['Harry Potter - Rowling'],
      authors: [],
    });

    await putStatsTagsBatch([
      {
        tagId: 183,
        name: 'Harry Potter - Rowling',
        type: 'Fandom',
        canonical: false,
        cachedCount: 6220,
        mergerId: 136512,
      },
      {
        tagId: 136512,
        name: 'Harry Potter - J. K. Rowling',
        type: 'Fandom',
        canonical: true,
        cachedCount: 361919,
        mergerId: null,
      },
    ]);

    const merged = await applyStatsTagMergesToGraph();
    expect(merged).toBe(1);

    const canonical = await getTagNode('Harry Potter - J. K. Rowling');
    const synonym = await getTagNode('Harry Potter - Rowling');
    expect(canonical).not.toBeNull();
    expect(synonym).toBeNull();
  });

  it('routes new tag upserts through canonical names when stats are known', async () => {
    await putStatsTagsBatch([
      {
        tagId: 183,
        name: 'Harry Potter - Rowling',
        type: 'Fandom',
        canonical: false,
        cachedCount: 6220,
        mergerId: 136512,
      },
      {
        tagId: 136512,
        name: 'Harry Potter - J. K. Rowling',
        type: 'Fandom',
        canonical: true,
        cachedCount: 361919,
        mergerId: null,
      },
    ]);

    const resolved = await resolveGraphTagName('Harry Potter - Rowling');
    expect(resolved).toBe('Harry Potter - J. K. Rowling');

    await mergeWorkPage({
      workId: '10',
      title: 'Work',
      tags: ['Harry Potter - Rowling'],
      authors: [],
    });

    const snapshot = await loadGraphSnapshot();
    const tagNodes = snapshot.nodes.filter((node) => node.kind === NodeKind.Tag);
    expect(tagNodes).toHaveLength(1);
    expect(tagNodes[0]?.key).toBe('Harry Potter - J. K. Rowling');
  });
});
