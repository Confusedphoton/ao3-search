import { describe, expect, it } from 'vitest';
import {
  isContentStatsTagType,
  isRedactedStatsTagName,
  isStatsTagsFileName,
  parseCsvLine,
  parseStatsTagRow,
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

  it('skips redacted tag rows', () => {
    expect(parseStatsTagRow('42,Freeform,Redacted,true,100,')).toBeNull();
    expect(isRedactedStatsTagName('Redacted')).toBe(true);
    expect(isRedactedStatsTagName(' Fluff ')).toBe(false);
  });

  it('recognizes official dump filenames', () => {
    expect(isStatsTagsFileName('tags-20210226.csv')).toBe(true);
    expect(isStatsTagsFileName('works-20210226.csv')).toBe(false);
  });

  it('filters system tag types', () => {
    expect(isContentStatsTagType('Fandom')).toBe(true);
    expect(isContentStatsTagType('Rating')).toBe(false);
  });
});
