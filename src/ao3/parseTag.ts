import { selectors, tagCountPattern } from './selectors';
import type { TagPageData } from './types';
import { parseTagNameFromUrl, tagWorksUrl } from './types';

function parseWorkIdFromHref(href: string): string | null {
  const match = href.match(/\/works\/(\d+)/);
  return match ? match[1] : null;
}

export function parseTagPage(doc: Document, url: string): TagPageData | null {
  const tagName = parseTagNameFromUrl(url);
  if (!tagName) return null;

  const heading = doc.querySelector(selectors.tagHeading)?.textContent ?? '';
  const countMatch = heading.match(tagCountPattern);
  const workCount = countMatch
    ? Number.parseInt(countMatch[1].replace(/,/g, ''), 10)
    : null;

  const workIds: string[] = [];
  const links = doc.querySelectorAll(selectors.workListing);
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const workId = parseWorkIdFromHref(href);
    if (workId) workIds.push(workId);
  }

  return {
    kind: 'tag',
    tagName,
    workCount,
    workIds,
    url: tagWorksUrl(tagName),
  };
}

export function parseTagPageFromHtml(html: string, url: string): TagPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseTagPage(doc, url);
}
