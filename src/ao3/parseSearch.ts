import { parseListedWorks } from './parseListings';
import { parseListingPagination } from './parsePagination';
import { selectors, tagCountPattern } from './selectors';
import type { SearchPageData } from './types';
import { isSearchResultsUrl } from './types';

export function parseSearchPage(doc: Document, url: string): SearchPageData | null {
  if (!isSearchResultsUrl(url)) return null;

  const heading = doc.querySelector(selectors.tagHeading)?.textContent ?? '';
  const countMatch = heading.match(tagCountPattern) ?? heading.match(/([\d,]+)\s+Found/i);
  const workCount = countMatch
    ? Number.parseInt(countMatch[1].replace(/,/g, ''), 10)
    : null;

  const { page, nextPage } = parseListingPagination(doc, url);

  return {
    kind: 'search',
    works: parseListedWorks(doc),
    url,
    workCount,
    page,
    nextPage,
  };
}

export function parseSearchPageFromHtml(html: string, url: string): SearchPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseSearchPage(doc, url);
}
