import { selectors } from './selectors';
import type { ListedWork } from './types';

function parseWorkIdFromHref(href: string): string | null {
  const match = href.match(/\/works\/(\d+)/);
  return match ? match[1] : null;
}

export function parseListedWorks(doc: Document): ListedWork[] {
  const works: ListedWork[] = [];
  const seen = new Set<string>();

  for (const link of doc.querySelectorAll(selectors.workListing)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const workId = parseWorkIdFromHref(href);
    if (!workId || seen.has(workId)) continue;
    seen.add(workId);
    const title = link.textContent?.trim() || `Work ${workId}`;
    works.push({ workId, title });
  }

  return works;
}
