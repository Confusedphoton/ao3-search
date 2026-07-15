import { selectors } from './selectors';

export interface ListingPagination {
  page: number;
  nextPage: number | null;
}

/**
 * Parse AO3 listing/search pagination. Returns page 1 / no next when absent.
 */
export function parseListingPagination(doc: Document, url: string): ListingPagination {
  const fromUrl = pageFromUrl(url);
  const currentEl = doc.querySelector(selectors.paginationCurrent);
  const currentText = currentEl?.textContent?.replace(/[^\d]/g, '') ?? '';
  const pageFromDom = currentText ? Number.parseInt(currentText, 10) : NaN;
  const page = Number.isFinite(pageFromDom) && pageFromDom > 0 ? pageFromDom : fromUrl;

  const nextHref = doc.querySelector(selectors.paginationNext)?.getAttribute('href');
  if (!nextHref) {
    return { page, nextPage: null };
  }

  const nextPage = pageFromHref(nextHref) ?? page + 1;
  return { page, nextPage };
}

function pageFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get('page');
    if (!raw) return 1;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function pageFromHref(href: string): number | null {
  try {
    const parsed = new URL(href, 'https://archiveofourown.org');
    const raw = parsed.searchParams.get('page');
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
