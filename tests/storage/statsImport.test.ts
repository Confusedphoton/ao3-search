import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/src/config/constants';
import {
  closeDbForTests,
  mergeWorkPage,
  putStatsTagsBatch,
  resetDbForTests,
} from '@/src/storage/db';
import { StatsTagsImporter, StatsWorksImporter } from '@/src/storage/statsImport';

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

describe('stats metadata import', () => {
  beforeEach(async () => {
    await deleteTestDb();
  });

  afterEach(async () => {
    await deleteTestDb();
  });

  it('calibrates graph tags and stores global metadata', async () => {
    await mergeWorkPage({
      workId: '1',
      title: 'Seed',
      tags: ['Fluff', 'Romance'],
      authors: [],
    });

    const importer = await StatsTagsImporter.create();
    await importer.processLines([
      'id,type,name,canonical,cached_count,merger_id',
      '10,Rating,General Audiences,true,2115153,',
      '100,Freeform,Fluff,true,1200,',
      '101,Freeform,Romance,true,900,',
      '102,Freeform,Unseen Tag,true,50,',
    ]);
    const result = await importer.finish();

    expect(result.tagsStored).toBe(4);
    expect(result.tagsCalibrated).toBe(2);
    expect(result.tagsMerged).toBe(0);
  });

  it('adds tag edges from works rows that match graph work keys', async () => {
    await mergeWorkPage({
      workId: '1',
      title: 'Seed',
      tags: [],
      authors: [],
    });

    await putStatsTagsBatch([
      {
        tagId: 10,
        name: 'General Audiences',
        type: 'Rating',
        canonical: true,
        cachedCount: 100,
        mergerId: null,
      },
      {
        tagId: 200,
        name: 'Fluff',
        type: 'Freeform',
        canonical: true,
        cachedCount: 1200,
        mergerId: null,
      },
    ]);

    const importer = await StatsWorksImporter.create();
    await importer.processLines([
      'creation date,language,restricted,complete,word_count,tags,',
      '2021-02-26,en,false,true,388,10+200',
      '2021-02-26,en,false,true,500,10+200+201',
    ]);
    const result = await importer.finish();

    expect(result.worksMatched).toBe(1);
    expect(result.edgesAdded).toBe(1);
  });
});
