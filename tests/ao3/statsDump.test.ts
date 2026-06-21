import { describe, expect, it } from 'vitest';
import {
  isContentStatsTagType,
  isStatsTagsFileName,
  isStatsWorksFileName,
  parseCsvLine,
  parseStatsTagRow,
  parseStatsWorkRow,
} from '@/src/ao3/statsDump';

describe('stats dump CSV parsing', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsvLine('1,Fandom,"Harry Potter, AU",true,42,')).toEqual([
      '1',
      'Fandom',
      'Harry Potter, AU',
      'true',
      '42',
      '',
    ]);
  });

  it('parses tag rows', () => {
    const row = parseStatsTagRow('99,Relationship,Draco Malfoy/Harry Potter,true,74244,136512');
    expect(row).toEqual({
      tagId: 99,
      type: 'Relationship',
      name: 'Draco Malfoy/Harry Potter',
      canonical: true,
      cachedCount: 74244,
      mergerId: 136512,
    });
  });

  it('parses work rows with tag ids', () => {
    const row = parseStatsWorkRow(
      '2021-02-26,en,false,true,388,10+414093+1001939+21+16',
      1,
    );
    expect(row).toEqual({
      rowId: 1,
      creationDate: '2021-02-26',
      language: 'en',
      restricted: false,
      complete: true,
      wordCount: 388,
      tagIds: [10, 414093, 1001939, 21, 16],
    });
  });

  it('recognizes official dump filenames', () => {
    expect(isStatsTagsFileName('tags-20210226.csv')).toBe(true);
    expect(isStatsWorksFileName('works-20210226.csv')).toBe(true);
    expect(isStatsTagsFileName('works-20210226.csv')).toBe(false);
  });

  it('filters system tag types', () => {
    expect(isContentStatsTagType('Fandom')).toBe(true);
    expect(isContentStatsTagType('Rating')).toBe(false);
  });
});
