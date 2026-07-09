import { describe, expect, it } from 'vitest';
import {
  parseAuthorPageFromHtml,
  parseListedWorks,
  parseSearchPageFromHtml,
  parseTagPageFromHtml,
  parseWorkPageFromHtml,
} from '@/src/ao3';
import {
  decodeAo3TagParam,
  encodeAo3TagParam,
  isSearchResultsUrl,
  parseAuthorKeyFromHref,
  parseAuthorKeyFromUrl,
  parseTagNameFromUrl,
  tagWorksUrl,
} from '@/src/ao3/types';

const emptyMeta = {
  language: null,
  rating: null,
  archiveWarnings: [],
  completionStatus: null,
  fandoms: [],
  categories: [],
};

const workHtml = `
<html><body>
  <h2 class="title heading">Test Work</h2>
  <dl class="work meta group">
    <dd class="rating tags"><a class="tag" href="/tags/Explicit">Explicit</a></dd>
    <dd class="warning tags"><a class="tag" href="/tags/No%20Archive%20Warnings%20Apply">No Archive Warnings Apply</a></dd>
    <dd class="category tags"><a class="tag" href="/tags/M*s*M">M/M</a></dd>
    <dd class="fandom tags"><a class="tag" href="/tags/Harry%20Potter">Harry Potter</a></dd>
    <dd class="freeform tags"><a class="tag" href="/tags/Fluff">Fluff</a></dd>
    <dd class="language">English</dd>
    <dd class="chapters">3/3</dd>
    <dd class="words">12,345 Words</dd>
    <dd class="users"><a href="/users/AuthorName">Author Name</a></dd>
  </dl>
</body></html>`;

const tagHtml = `
<html><body>
  <h2 class="heading">Works tagged as Harry Potter</h2>
  <ol class="work index group">
    <li class="work blurb">
      <div class="header module">
        <h4 class="heading">
          <a href="/works/12345">Story</a> by <a rel="author" href="/users/WriterOne">Writer One</a>
        </h4>
        <h5 class="fandoms heading"><a class="tag" href="/tags/Harry%20Potter">Harry Potter</a></h5>
        <ul class="required-tags">
          <li><span class="rating" title="Teen And Up Audiences"><span class="text">Teen And Up Audiences</span></span></li>
          <li><span class="warnings" title="No Archive Warnings Apply"><span class="text">No Archive Warnings Apply</span></span></li>
          <li><span class="category" title="M/M"><span class="text">M/M</span></span></li>
          <li><span class="iswip" title="Complete"><span class="text">Complete</span></span></li>
        </ul>
      </div>
      <ul class="tags commas">
        <li class="warnings"><a class="tag" href="/tags/No%20Archive%20Warnings%20Apply">No Archive Warnings Apply</a></li>
        <li class="relationships"><a class="tag" href="/tags/Draco%20Malfoy*s*Harry%20Potter">Draco Malfoy/Harry Potter</a></li>
        <li class="freeforms"><a class="tag" href="/tags/Fluff">Fluff</a></li>
      </ul>
      <dl class="stats">
        <dt class="language">Language:</dt>
        <dd class="language">English</dd>
        <dt class="chapters">Chapters:</dt>
        <dd class="chapters">1/1</dd>
      </dl>
    </li>
    <li class="work blurb">
      <h4 class="heading"><a href="/works/67890">Other</a></h4>
    </li>
  </ol>
</body></html>`;

const authorHtml = `
<html><body>
  <h2 class="heading">Author Name - Works</h2>
  <ol class="work index group">
    <li class="work blurb">
      <h4 class="heading">
        <a href="/works/11111">Fic A</a> by <a rel="author" href="/users/AuthorName">Author Name</a>
      </h4>
      <ul class="tags commas">
        <li class="fandoms"><a class="tag" href="/tags/Marvel">Marvel</a></li>
      </ul>
    </li>
    <li class="work blurb">
      <h4 class="heading">
        <a href="/works/22222">Fic B</a> by
        <a rel="author" href="/users/AuthorName">Author Name</a> and
        <a rel="author" href="/users/CoAuthor">Co Author</a>
      </h4>
    </li>
  </ol>
</body></html>`;

describe('AO3 parsers', () => {
  it('parses work pages including authors', () => {
    const parsed = parseWorkPageFromHtml(
      workHtml,
      'https://archiveofourown.org/works/42',
    );
    expect(parsed).toMatchObject({
      kind: 'work',
      workId: '42',
      title: 'Test Work',
      wordCount: 12345,
      tags: ['Harry Potter', 'Fluff'],
      authors: [{ key: 'AuthorName', displayName: 'Author Name' }],
      meta: {
        language: 'English',
        rating: 'Explicit',
        archiveWarnings: ['No Archive Warnings Apply'],
        completionStatus: 'Complete',
        fandoms: ['Harry Potter'],
        categories: ['M/M'],
      },
    });
  });

  it('parses tag listing pages with blurb tags and authors', () => {
    const parsed = parseTagPageFromHtml(
      tagHtml,
      'https://archiveofourown.org/tags/Harry%20Potter/works',
    );
    expect(parsed).toMatchObject({
      kind: 'tag',
      tagName: 'Harry Potter',
      works: [
        {
          workId: '12345',
          title: 'Story',
          tags: ['Harry Potter', 'No Archive Warnings Apply', 'Draco Malfoy/Harry Potter', 'Fluff'],
          authors: [{ key: 'WriterOne', displayName: 'Writer One' }],
          wordCount: null,
          meta: {
            language: 'English',
            rating: 'Teen And Up Audiences',
            archiveWarnings: ['No Archive Warnings Apply'],
            completionStatus: 'Complete',
            fandoms: ['Harry Potter'],
            categories: ['M/M'],
          },
        },
        {
          workId: '67890',
          title: 'Other',
          tags: [],
          authors: [],
          wordCount: null,
          meta: emptyMeta,
        },
      ],
    });
  });

  it('parses author listing pages with blurb tags and authors', () => {
    const parsed = parseAuthorPageFromHtml(
      authorHtml,
      'https://archiveofourown.org/users/AuthorName/works',
    );
    expect(parsed).toMatchObject({
      kind: 'author',
      authorKey: 'AuthorName',
      displayName: 'Author Name',
      works: [
        {
          workId: '11111',
          title: 'Fic A',
          tags: ['Marvel'],
          authors: [{ key: 'AuthorName', displayName: 'Author Name' }],
          wordCount: null,
          meta: { ...emptyMeta, fandoms: [] },
        },
        {
          workId: '22222',
          title: 'Fic B',
          tags: [],
          authors: [
            { key: 'AuthorName', displayName: 'Author Name' },
            { key: 'CoAuthor', displayName: 'Co Author' },
          ],
          wordCount: null,
          meta: emptyMeta,
        },
      ],
    });
  });

  it('deduplicates fandom tags that also appear in ul.tags', () => {
    const html = `
      <html><body>
        <ol class="work index group">
          <li class="work blurb">
            <h4 class="heading"><a href="/works/1">Title</a></h4>
            <h5 class="fandoms heading"><a class="tag" href="/tags/Fluff">Fluff</a></h5>
            <ul class="tags commas">
              <li class="freeforms"><a class="tag" href="/tags/Fluff">Fluff</a></li>
            </ul>
          </li>
        </ol>
      </body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(parseListedWorks(doc)).toEqual([
      {
        workId: '1',
        title: 'Title',
        tags: ['Fluff'],
        authors: [],
        wordCount: null,
        meta: { ...emptyMeta, fandoms: ['Fluff'] },
      },
    ]);
  });

  it('parses search listing pages with blurbs including word counts', () => {
    const searchHtml = `
      <html><body>
        <ol class="work index group">
          <li class="work blurb">
            <h4 class="heading">
              <a href="/works/49557145">Fluff, Fluff, Fluff...</a>
              by <a rel="author" href="/users/brhmsheelshirebf/pseuds/brhmsheelshirebf">brhmsheelshirebf</a>
            </h4>
            <h5 class="fandoms heading"><a class="tag" href="/tags/Marvel%20Cinematic%20Universe/works">Marvel Cinematic Universe</a></h5>
            <ul class="tags commas">
              <li class="freeforms"><a class="tag" href="/tags/Fluff/works">Fluff</a></li>
            </ul>
            <dl class="stats">
              <dt class="words">Words:</dt>
              <dd class="words">1,355</dd>
            </dl>
          </li>
        </ol>
      </body></html>`;
    const parsed = parseSearchPageFromHtml(
      searchHtml,
      'https://archiveofourown.org/works/search?work_search%5Bquery%5D=fluff',
    );
    expect(parsed).toMatchObject({
      kind: 'search',
      works: [
        {
          workId: '49557145',
          title: 'Fluff, Fluff, Fluff...',
          tags: ['Marvel Cinematic Universe', 'Fluff'],
          authors: [{ key: 'brhmsheelshirebf/pseuds/brhmsheelshirebf', displayName: 'brhmsheelshirebf' }],
          wordCount: 1355,
          meta: { ...emptyMeta, fandoms: ['Marvel Cinematic Universe'] },
        },
      ],
    });
  });

  it('detects AO3 work search result URLs', () => {
    expect(
      isSearchResultsUrl('https://archiveofourown.org/works/search?work_search%5Bquery%5D=fluff'),
    ).toBe(true);
    expect(isSearchResultsUrl('https://archiveofourown.org/works/12345')).toBe(false);
    expect(isSearchResultsUrl('https://archiveofourown.org/tags/Fluff/works')).toBe(false);
  });

  it('encodes AO3 tag path tokens like Tag#to_param', () => {
    expect(encodeAo3TagParam('M/M')).toBe('M*s*M');
    expect(encodeAo3TagParam('F/F')).toBe('F*s*F');
    expect(encodeAo3TagParam('Multi')).toBe('Multi');
    expect(encodeAo3TagParam('A & B')).toBe('A%20*a*%20B');
    expect(encodeAo3TagParam('Dr. Who')).toBe('Dr*d*%20Who');
    expect(tagWorksUrl('M/M')).toBe('https://archiveofourown.org/tags/M*s*M/works');
    expect(tagWorksUrl('Draco Malfoy/Harry Potter')).toBe(
      'https://archiveofourown.org/tags/Draco%20Malfoy*s*Harry%20Potter/works',
    );
  });

  it('decodes AO3 tag path tokens like Tag.from_param', () => {
    expect(decodeAo3TagParam('M*s*M')).toBe('M/M');
    expect(decodeAo3TagParam('A%20*a*%20B')).toBe('A & B');
    expect(decodeAo3TagParam('Dr*d*%20Who')).toBe('Dr. Who');
    expect(parseTagNameFromUrl('https://archiveofourown.org/tags/M*s*M/works')).toBe('M/M');
    expect(
      parseTagNameFromUrl(
        'https://archiveofourown.org/tags/Draco%20Malfoy*s*Harry%20Potter/works',
      ),
    ).toBe('Draco Malfoy/Harry Potter');
  });

  it('parses pseud author keys from work links', () => {
    const pseudHtml = `
      <html><body>
        <dl class="work meta group">
          <dd class="users"><a href="/users/Lake/pseuds/PseudName">Pseud Name</a></dd>
        </dl>
      </body></html>`;
    const parsed = parseWorkPageFromHtml(
      pseudHtml,
      'https://archiveofourown.org/works/99',
    );
    expect(parsed?.authors).toEqual([
      { key: 'Lake/pseuds/PseudName', displayName: 'Pseud Name' },
    ]);
  });

  it('parses author keys from pseudonym listing pages', () => {
    expect(
      parseAuthorKeyFromUrl('https://archiveofourown.org/users/Lake/pseuds/PseudName/works'),
    ).toBe('Lake/pseuds/PseudName');
    expect(
      parseAuthorKeyFromUrl('https://archiveofourown.org/users/Lake/pseuds/PseudName'),
    ).toBe('Lake/pseuds/PseudName');
    expect(parseAuthorKeyFromUrl('https://archiveofourown.org/users/login')).toBeNull();
  });

  it('ignores gift recipient links when parsing authors from blurbs', () => {
    const giftHtml = `
      <html><body>
        <ol class="work index group">
          <li class="work blurb">
            <h4 class="heading">
              <a href="/works/55555">Gift Fic</a>
              by <a rel="author" href="/users/WriterOne">Writer One</a>
              for <a href="/users/Junespriince/gifts">Junespriince</a>
            </h4>
          </li>
        </ol>
      </body></html>`;
    const doc = new DOMParser().parseFromString(giftHtml, 'text/html');
    const works = parseListedWorks(doc);
    expect(works).toEqual([
      {
        workId: '55555',
        title: 'Gift Fic',
        tags: [],
        authors: [{ key: 'WriterOne', displayName: 'Writer One' }],
        wordCount: null,
        meta: emptyMeta,
      },
    ]);
    expect(parseAuthorKeyFromHref('/users/Junespriince/gifts')).toBeNull();
    expect(parseAuthorKeyFromHref('/users/Junespriince')).toBe('Junespriince');
    expect(parseAuthorKeyFromHref('/users/Lake/pseuds/PseudName')).toBe(
      'Lake/pseuds/PseudName',
    );
  });
});
