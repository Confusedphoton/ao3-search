import { selectors } from './selectors';
import type { WorkPageData } from './types';
import { parseAuthorKeyFromHref, parseWorkIdFromUrl, workUrl } from './types';

export function parseAuthorsFromDocument(doc: Document): Array<{ key: string; displayName: string }> {
  const authors: Array<{ key: string; displayName: string }> = [];
  const seen = new Set<string>();

  for (const link of doc.querySelectorAll(selectors.workAuthors)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const key = parseAuthorKeyFromHref(href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    authors.push({
      key,
      displayName: link.textContent?.trim() || key,
    });
  }

  return authors;
}

export function parseWorkPage(doc: Document, url: string): WorkPageData | null {
  const workId = parseWorkIdFromUrl(url);
  if (!workId) return null;

  const titleEl = doc.querySelector(selectors.workTitle);
  const title = titleEl?.textContent?.trim() || `Work ${workId}`;

  const tagEls = doc.querySelectorAll(selectors.workTags);
  const tags = [...tagEls]
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);

  return {
    kind: 'work',
    workId,
    title,
    tags,
    authors: parseAuthorsFromDocument(doc),
    url: workUrl(workId),
  };
}

export function parseWorkPageFromHtml(html: string, url: string): WorkPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseWorkPage(doc, url);
}
