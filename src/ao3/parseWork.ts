import { selectors } from './selectors';
import type { WorkPageData } from './types';
import { parseWorkIdFromUrl, workUrl } from './types';

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
    url: workUrl(workId),
  };
}

export function parseWorkPageFromHtml(html: string, url: string): WorkPageData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseWorkPage(doc, url);
}
