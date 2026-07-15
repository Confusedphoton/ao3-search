import { parseListedWorks } from './parseListings';
import { parseListingPagination } from './parsePagination';
import { selectors, tagCountPattern } from './selectors';
import type { TagPageData } from './types';
import { parseTagNameFromUrl, tagWorksUrl } from './types';

export function parseTagPage(doc: Document, url: string): TagPageData | null {
  const tagName = parseTagNameFromUrl(url);
  if (!tagName) return null;

  const heading = doc.querySelector(selectors.tagHeading)?.textContent ?? '';
  const countMatch = heading.match(tagCountPattern);
  const workCount = countMatch
    ? Number.parseInt(countMatch[1].replace(/,/g, ''), 10)
    : null;

  const { page, nextPage } = parseListingPagination(doc, url);

  return {
    kind: 'tag',
    tagName,
    workCount,
    works: parseListedWorks(doc),
    url: tagWorksUrl(tagName, page),
    page,
    nextPage,
  };
}

export function parseTagPageFromHtml(html: string, url: string): TagPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseTagPage(doc, url);
}
