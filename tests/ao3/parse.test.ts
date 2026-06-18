import { describe, expect, it } from 'vitest';
import { parseTagPageFromHtml, parseWorkPageFromHtml } from '@/src/ao3';

const workHtml = `
<html><body>
  <h2 class="title heading">Test Work</h2>
  <dl class="work meta group">
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

describe('AO3 parsers', () => {
  it('parses work pages', () => {
    const parsed = parseWorkPageFromHtml(
      workHtml,
      'https://archiveofourown.org/works/42',
    );
    expect(parsed).toMatchObject({
      kind: 'work',
      workId: '42',
      title: 'Test Work',
      tags: ['Harry Potter', 'Fluff'],
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
});
