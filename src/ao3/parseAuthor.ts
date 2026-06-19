import { parseListedWorks } from './parseListings';
import { selectors, tagCountPattern } from './selectors';
import type { AuthorPageData } from './types';
import { authorWorksUrl, parseAuthorKeyFromUrl } from './types';

export function parseAuthorPage(doc: Document, url: string): AuthorPageData | null {
  const authorKey = parseAuthorKeyFromUrl(url);
  if (!authorKey) return null;

  const heading = doc.querySelector(selectors.authorHeading)?.textContent ?? '';
  const countMatch = heading.match(tagCountPattern);
  const workCount = countMatch
    ? Number.parseInt(countMatch[1].replace(/,/g, ''), 10)
    : null;

  const displayName =
    heading.replace(/\s*-\s*Works.*$/i, '').replace(/^Works by\s+/i, '').trim() || authorKey;

  return {
    kind: 'author',
    authorKey,
    displayName,
    workCount,
    works: parseListedWorks(doc),
    url: authorWorksUrl(authorKey),
  };
}

export function parseAuthorPageFromHtml(html: string, url: string): AuthorPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseAuthorPage(doc, url);
}
