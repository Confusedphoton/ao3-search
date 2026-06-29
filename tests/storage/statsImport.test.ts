import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/src/config/constants';
import { closeDbForTests, mergeWorkPage, resetDbForTests } from '@/src/storage/db';
import { StatsTagsImporter } from '@/src/storage/statsImport';

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

  it('ignores redacted tag rows', async () => {
    const importer = await StatsTagsImporter.create();
    await importer.processLines([
      'id,type,name,canonical,cached_count,merger_id',
      '42,Freeform,Redacted,true,100,',
      '100,Freeform,Fluff,true,1200,',
    ]);
    const result = await importer.finish();

    expect(result.tagsStored).toBe(1);
  });
});
