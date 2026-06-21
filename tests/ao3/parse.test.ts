import { describe, expect, it } from 'vitest';
import {
  parseAuthorPageFromHtml,
  parseListedWorks,
  parseTagPageFromHtml,
  parseWorkPageFromHtml,
} from '@/src/ao3';
import { parseAuthorKeyFromUrl } from '@/src/ao3/types';

const workHtml = `
<html><body>
  <h2 class="title heading">Test Work</h2>
  <dl class="work meta group">
    <dd class="users"><a href="/users/AuthorName">Author Name</a></dd>
    <dd class="tags"><a class="tag" href="/tags/Harry%20Potter">Harry Potter</a></dd>
    <dd class="tags"><a class="tag" href="/tags/Fluff">Fluff</a></dd>
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
      </div>
      <ul class="tags commas">
        <li class="relationships"><a class="tag" href="/tags/Draco%20Malfoy%2FHarry%20Potter">Draco Malfoy/Harry Potter</a></li>
        <li class="freeforms"><a class="tag" href="/tags/Fluff">Fluff</a></li>
      </ul>
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
      tags: ['Harry Potter', 'Fluff'],
      authors: [{ key: 'AuthorName', displayName: 'Author Name' }],
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
          tags: ['Harry Potter', 'Draco Malfoy/Harry Potter', 'Fluff'],
          authors: [{ key: 'WriterOne', displayName: 'Writer One' }],
        },
        {
          workId: '67890',
          title: 'Other',
          tags: [],
          authors: [],
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
        },
        {
          workId: '22222',
          title: 'Fic B',
          tags: [],
          authors: [
            { key: 'AuthorName', displayName: 'Author Name' },
            { key: 'CoAuthor', displayName: 'Co Author' },
          ],
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
      },
    ]);
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
});
