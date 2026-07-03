import { parseListedWorks } from './parseListings';
import type { SearchPageData } from './types';
import { isSearchResultsUrl } from './types';

export function parseSearchPage(doc: Document, url: string): SearchPageData | null {
  if (!isSearchResultsUrl(url)) return null;

  return {
    kind: 'search',
    works: parseListedWorks(doc),
    url,
  };
}

export function parseSearchPageFromHtml(html: string, url: string): SearchPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseSearchPage(doc, url);
}
