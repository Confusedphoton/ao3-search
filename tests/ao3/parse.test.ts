import { describe, expect, it } from 'vitest';
import { parseAuthorPageFromHtml, parseTagPageFromHtml, parseWorkPageFromHtml } from '@/src/ao3';

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
      <h4 class="heading"><a href="/works/12345">Story</a></h4>
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
      <h4 class="heading"><a href="/works/11111">Fic A</a></h4>
    </li>
    <li class="work blurb">
      <h4 class="heading"><a href="/works/22222">Fic B</a></h4>
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

  it('parses tag listing pages', () => {
    const parsed = parseTagPageFromHtml(
      tagHtml,
      'https://archiveofourown.org/tags/Harry%20Potter/works',
    );
    expect(parsed).toMatchObject({
      kind: 'tag',
      tagName: 'Harry Potter',
      workIds: ['12345', '67890'],
    });
  });

  it('parses author listing pages', () => {
    const parsed = parseAuthorPageFromHtml(
      authorHtml,
      'https://archiveofourown.org/users/AuthorName/works',
    );
    expect(parsed).toMatchObject({
      kind: 'author',
      authorKey: 'AuthorName',
      displayName: 'Author Name',
      workIds: ['11111', '22222'],
    });
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
});
